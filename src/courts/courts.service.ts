import {
  Injectable,
  NotFoundException,
  ConflictException,
  Patch,
  Param,
  Body,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourtDto, UpdateCourtDto, CreateReviewDto } from './dto/court.dto';
import { Roles } from 'src/auth/decorators';
import { UpdateBookingStatusDto } from 'src/bookings/dto/booking.dto';
import { expireStaleBookingHolds, normalizeDate } from '../bookings/booking.helpers';

@Injectable()
export class CourtsService {
  bookingsService: any;
  constructor(private prisma: PrismaService) {}

  
  // ─────────────────────────────────────────────
  // admin, employee endpoints
  // ─────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateBookingStatusDto) {
    return this.bookingsService.updateStatus(id, dto)
  }

  // ─────────────────────────────────────────────
  // Private mapper: flatten Prisma court → snake_case (FE's transformCourt reads này)
  // ─────────────────────────────────────────────
  private mapCourt(c: any) {
    return {
      id:             c.id,
      name:           c.name,
      branch_id:      c.branchId,
      branch_name:    c.branch?.name || '',
      branch_address: c.branch?.address || '',
      branch_lat:     c.branch?.lat ? parseFloat(String(c.branch.lat)) : 0,
      branch_lng:     c.branch?.lng ? parseFloat(String(c.branch.lng)) : 0,
      type:           c.type,
      indoor:         c.indoor,
      price:          parseFloat(String(c.price)),
      rating:         parseFloat(String(c.rating || 0)),
      reviews_count:  c._count?.reviews ?? c.reviewsCount ?? 0,
      image:          c.image || null,
      available:      c.available,
      // FE expects string[] for amenities
      amenities:      (c.amenities || []).map((a: any) => typeof a === 'string' ? a : a.amenity),
      description:    c.description || '',
      hours:          c.hours || '06:00 - 22:00',
    }
  }

  // ─────────────────────────────────────────────
  // GET /courts — Danh sách sân (filter theo branch, type)
  // ─────────────────────────────────────────────
  async findAll(filters: { branchId?: number; type?: string; indoor?: boolean }) {
    const courts = await this.prisma.court.findMany({
      where: {
        available: true,
        ...(filters.branchId && { branchId: filters.branchId }),
        ...(filters.type && { type: filters.type as any }),
        ...(filters.indoor !== undefined && { indoor: filters.indoor }),
      },
      include: {
        branch: {
          select: { id: true, name: true, address: true, lat: true, lng: true },
        },
        amenities: true,
        _count: { select: { reviews: true } },
      },
      orderBy: { rating: 'desc' },
    });
    return courts.map(c => this.mapCourt(c));
  }

  // ─────────────────────────────────────────────
  // GET /courts/:id — Chi tiết 1 sân
  // ─────────────────────────────────────────────
  async findOne(id: number) {
    const court = await this.prisma.court.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true, address: true, lat: true, lng: true } },
        amenities: true,
        reviews: {
          include: {
            user: { select: { fullName: true, username: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: { select: { reviews: true } },
      },
    });
    if (!court) throw new NotFoundException(`Sân #${id} không tồn tại`);
    return {
      ...this.mapCourt(court),
      reviews: court.reviews,
    };
  }

  // ─────────────────────────────────────────────
  // GET /courts/:id/slots?date=2025-03-10
  // Lấy danh sách slot theo ngày (trống/đã đặt)
  // ─────────────────────────────────────────────
  async getSlots(courtId: number, date: string) {
    await expireStaleBookingHolds(this.prisma);

    const court = await this.prisma.court.findUnique({
      where: { id: courtId },
      select: { price: true, hours: true },
    });
    if (!court) throw new NotFoundException(`Sân #${courtId} không tồn tại`);

    // Tạo tất cả slot từ 06:00 → 21:00
    const allSlots = Array.from({ length: 16 }, (_, i) => {
      const h = i + 6;
      return `${String(h).padStart(2, '0')}:00`;
    });

    // Slot đã bị đặt/giữ trong ngày
    const bookedSlots = await this.prisma.courtSlot.findMany({
      where: {
        courtId,
        slotDate: normalizeDate(date),
        status: { in: ['booked', 'hold'] },
      },
      select: { time: true, status: true },
    });

    const bookedMap = new Map(bookedSlots.map((s) => [s.time, s.status]));

    return allSlots.map((time) => ({
      time,
      available: !bookedMap.has(time),
      status: bookedMap.get(time) || 'available',
      price: Number(court.price),
    }));
  }

  // ─────────────────────────────────────────────
  // POST /courts — Tạo sân mới (Admin)
  // ─────────────────────────────────────────────
  async create(dto: CreateCourtDto) {
    const { amenities, ...courtData } = dto;
    return this.prisma.court.create({
      data: {
        ...courtData,
        amenities: amenities?.length
          ? { create: amenities.map((a) => ({ amenity: a })) }
          : undefined,
      },
      include: { amenities: true, branch: true },
    });
  }

  // ─────────────────────────────────────────────
  // PUT /courts/:id — Cập nhật sân (Admin)
  // ─────────────────────────────────────────────
  async update(id: number, dto: UpdateCourtDto) {
    await this.findOne(id);
    const { amenities, ...courtData } = dto;

    return this.prisma.court.update({
      where: { id },
      data: {
        ...courtData,
        ...(amenities && {
          amenities: {
            deleteMany: {},
            create: amenities.map((a) => ({ amenity: a })),
          },
        }),
      },
      include: { amenities: true },
    });
  }

  // ─────────────────────────────────────────────
  // PATCH /courts/:id/toggle — Ẩn/Hiện sân (Admin)
  // ─────────────────────────────────────────────
  async toggle(id: number) {
    const court = await this.findOne(id);
    return this.prisma.court.update({
      where: { id },
      data: { available: !court.available },
    });
  }

  // ─────────────────────────────────────────────
  // POST /courts/:id/reviews — Đánh giá sân (User)
  // ─────────────────────────────────────────────
  async createReview(courtId: number, userId: string, dto: CreateReviewDto) {
    await this.findOne(courtId);

    // Kiểm tra user đã review chưa
    const existing = await this.prisma.review.findUnique({
      where: { userId_courtId: { userId, courtId } },
    });
    if (existing) throw new ConflictException('Bạn đã đánh giá sân này rồi');

    // Tạo review
    const review = await this.prisma.review.create({
      data: { courtId, userId, rating: dto.rating, content: dto.content },
      include: { user: { select: { fullName: true } } },
    });

    // Cập nhật rating trung bình của sân
    const stats = await this.prisma.review.aggregate({
      where: { courtId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await this.prisma.court.update({
      where: { id: courtId },
      data: {
        rating: stats._avg.rating || 0,
        reviewsCount: stats._count.rating,
      },
    });

    return review;
  }

  // ─────────────────────────────────────────────
  // GET /courts/:id/reviews — Lấy đánh giá sân
  // ─────────────────────────────────────────────
  async getReviews(courtId: number) {
    await this.findOne(courtId);
    return this.prisma.review.findMany({
      where: { courtId },
      include: { user: { select: { fullName: true, username: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
