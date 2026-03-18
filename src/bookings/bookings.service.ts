import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBookingDto, UpdateBookingStatusDto } from './dto/booking.dto';
import { BookingStatus } from '@prisma/client';
import { EmailService } from '../email/email.service'

@Injectable()
export class BookingsService {
  constructor(
  private prisma: PrismaService,
  private emailService: EmailService,
) {}

  // ═══════════════════════════════════════════════
  // TẠO BOOKING — Quan trọng nhất, chống double-booking
  // ═══════════════════════════════════════════════
  async create(dto: CreateBookingDto) {
    const { courtId, bookingDate, timeStart, timeEnd } = dto;

    // 1. Tính danh sách giờ từ timeStart → timeEnd
    const startHour = parseInt(timeStart.split(':')[0]);
    const endHour   = parseInt(timeEnd.split(':')[0]);

    if (endHour <= startHour) {
      throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu');
    }
    if (endHour - startHour > 4) {
      throw new BadRequestException('Tối đa chỉ được đặt 4 giờ liên tiếp');
    }

    // VD: timeStart=08:00, timeEnd=10:00 → ["08:00", "09:00"]
    const hours = Array.from({ length: endHour - startHour }, (_, i) =>
      `${String(startHour + i).padStart(2, '0')}:00`
    );

    const dateObj  = new Date(bookingDate);
    const dayLabel = `${dateObj.getDate()}/${dateObj.getMonth() + 1}`;

    // 2. Dùng Transaction để đảm bảo atomic
    return this.prisma.$transaction(async (tx) => {

      // 3. Kiểm tra sân có tồn tại không
      const court = await tx.court.findUnique({
        where: { id: courtId },
        select: { id: true, price: true, branchId: true, available: true, name: true },
      });
      if (!court) throw new NotFoundException('Sân không tồn tại');
      if (!court.available) throw new BadRequestException('Sân hiện đang đóng cửa');

      // 4. Kiểm tra slot có bị đặt chưa (chống double-booking)
      const conflictSlots = await tx.courtSlot.findMany({
        where: {
          courtId,
          slotDate: dateObj,
          time: { in: hours },
          status: { in: ['booked', 'hold'] },
        },
      });

      if (conflictSlots.length > 0) {
        const conflictTimes = conflictSlots.map((s) => s.time).join(', ');
        throw new ConflictException(
          `Sân đã được đặt vào lúc: ${conflictTimes}. Vui lòng chọn giờ khác!`
        );
      }

      // 5. Tính tổng tiền
      const amount = Number(court.price) * hours.length;

      // 6. Tạo booking
      const booking = await tx.booking.create({
        data: {
          courtId,
          branchId:      court.branchId,
          bookingDate:   dateObj,
          dayLabel,
          timeStart,
          timeEnd,
          amount,
          people:        dto.people || 2,
          paymentMethod: dto.paymentMethod,
          customerName:  dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail,
          userId:        dto.userId,
          status:        BookingStatus.pending,
        },
      });

      // 7. Tạo court_slots với status 'hold' (chờ xác nhận)
      await tx.courtSlot.createMany({
        data: hours.map((time) => ({
          courtId,
          slotDate:  dateObj,
          dateLabel: dayLabel,
          time,
          status:    'hold' as const,
          bookedBy:  dto.customerName,
          phone:     dto.customerPhone,
          bookingId: booking.id,
        })),
      });

      return {
        ...booking,
        slots:  hours,
        amount,
        court: { name: court.name },
      };
    });
  }

  // ═══════════════════════════════════════════════
  // XÁC NHẬN BOOKING (pending → confirmed)
  // ═══════════════════════════════════════════════
   async confirm(id: string) {
    const booking = await this.findOne(id)

    if (booking.status !== 'pending') {
      throw new BadRequestException(
        `Không thể xác nhận booking đang ở trạng thái "${booking.status}"`
      )
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data:  { status: 'confirmed' },
      include: {
        court: { include: { branch: true } },
        user:  true,
      },
    })

    // Gửi email thông báo cho khách
    const email = updated.customerEmail || updated.user?.email
    if (email) {
      await this.emailService.sendBookingConfirmed({
        id:          updated.id,
        customerName:  updated.customerName || updated.user?.fullName || 'Quý khách',
        customerEmail: email,
        courtName:   updated.court.name,
        branchName:  updated.court.branch?.name ?? '',
        bookingDate: updated.bookingDate.toISOString(),
        timeStart: updated.timeStart ?? '',
        timeEnd:   updated.timeEnd   ?? '',
        amount:      parseFloat(String(updated.amount)),
      })
    }

    return { success: true, booking: updated }
  }

  // ─── PLAYING: confirmed → playing ──────────────────────────
  async startPlaying(id: string) {
    const booking = await this.findOne(id)

    if (booking.status !== 'confirmed') {
      throw new BadRequestException(
        `Không thể chuyển sang "đang chơi" khi booking ở trạng thái "${booking.status}"`
      )
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data:  { status: 'playing' },
      include: { court: { include: { branch: true } }, user: true },
    })

    return { success: true, booking: updated }
  }

  // ─── COMPLETE: playing → completed ─────────────────────────
  async complete(id: string) {
    const booking = await this.findOne(id)

    if (booking.status !== 'playing') {
      throw new BadRequestException(
        `Không thể hoàn thành booking đang ở trạng thái "${booking.status}"`
      )
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data:  { status: 'completed' },
      include: { court: { include: { branch: true } }, user: true },
    })

    return { success: true, booking: updated }
  }

  // ═══════════════════════════════════════════════
  // HỦY BOOKING
  // ═══════════════════════════════════════════════
   async cancel(id: string) {
    const booking = await this.findOne(id)

    if (['completed', 'cancelled'].includes(booking.status)) {
      throw new BadRequestException('Không thể huỷ booking này')
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data:  { status: 'cancelled' },
      include: { court: { include: { branch: true } }, user: true },
    })

    return { success: true, booking: updated }
  }

  // ═══════════════════════════════════════════════
  // CẬP NHẬT TRẠNG THÁI (Admin/Employee)
  // ═══════════════════════════════════════════════
  async updateStatus(id: string, dto: UpdateBookingStatusDto) {
  const booking = await this.findOne(id)

  const validTransitions: Record<string, string[]> = {
    pending:   ['confirmed', 'cancelled'],
    confirmed: ['playing', 'cancelled'],
    playing:   ['completed'],
    completed: [],
    cancelled: [],
  }

  if (!validTransitions[booking.status]?.includes(dto.status)) {
    throw new BadRequestException(
      `Không thể chuyển từ "${booking.status}" sang "${dto.status}"`
    )
  }

  // ✅ Gọi đúng method cho từng transition
  switch (dto.status) {
    case 'confirmed': return this.confirm(id)
    case 'playing':   return this.startPlaying(id)
    case 'completed': return this.complete(id)
    case 'cancelled': return this.cancel(id)
  }
}

  // ═══════════════════════════════════════════════
  // DANH SÁCH BOOKING (Admin/Employee)
  // ═══════════════════════════════════════════════
  async findAll(filters: {
    branchId?: number;
    courtId?: number;
    date?: string;
    status?: string;
    phone?: string;
  }) {
    return this.prisma.booking.findMany({
      where: {
        ...(filters.branchId && { branchId: filters.branchId }),
        ...(filters.courtId  && { courtId: filters.courtId }),
        ...(filters.date     && { bookingDate: new Date(filters.date) }),
        ...(filters.status   && { status: filters.status as BookingStatus }),
        ...(filters.phone    && { customerPhone: { contains: filters.phone } }),
      },
      include: {
        court:  { select: { name: true, type: true } },
        branch: { select: { name: true } },
        user:   { select: { fullName: true, phone: true } },
      },
      orderBy: [{ bookingDate: 'desc' }, { timeStart: 'asc' }],
    });
  }

  // ═══════════════════════════════════════════════
  // BOOKING CỦA 1 USER (lịch sử đặt sân)
  // ═══════════════════════════════════════════════
  async findByUser(userId: string) {
    return this.prisma.booking.findMany({
      where: { userId },
      include: {
        court: {
          select: { name: true, image: true, type: true, price: true },
        },
        branch: { select: { name: true, address: true } },
        slots:  { select: { time: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ═══════════════════════════════════════════════
  // CHI TIẾT 1 BOOKING
  // ═══════════════════════════════════════════════
  async findOne(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        court:  { include: { amenities: true } },
        branch: true,
        user:   { select: { fullName: true, email: true, phone: true } },
        slots:  { orderBy: { time: 'asc' } },
      },
    });
    if (!booking) throw new NotFoundException(`Booking #${id} không tồn tại`);
    return booking;
  }

  // ═══════════════════════════════════════════════
  // BOOKING HÔM NAY theo chi nhánh (Dashboard)
  // ═══════════════════════════════════════════════
  async getTodayBookings(branchId?: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.booking.findMany({
      where: {
        bookingDate: today,
        status: { in: ['confirmed', 'playing'] },
        ...(branchId && { branchId }),
      },
      include: {
        court:  { select: { name: true, type: true } },
        branch: { select: { name: true } },
      },
      orderBy: { timeStart: 'asc' },
    });
  }

  async checkin(bookingId: string) {
  // 1. Tìm booking
  const booking = await this.prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      court: { include: { branch: true } },
      user: true,
    },
  });
 
  if (!booking) {
    throw new NotFoundException('Không tìm thấy booking');
  }
 
  // 2. Kiểm tra trạng thái hợp lệ để check-in
  if (booking.status === 'playing') {
    throw new BadRequestException('Khách đã check-in rồi');
  }
  if (booking.status === 'completed') {
    throw new BadRequestException('Booking đã hoàn thành');
  }
  if (booking.status === 'cancelled') {
    throw new BadRequestException('Booking đã bị hủy');
  }
  if (booking.status === 'pending') {
    throw new BadRequestException('Booking chưa được xác nhận thanh toán');
  }
 
  // 3. Kiểm tra ngày giờ hợp lệ (±30 phút so với giờ chơi)
  const today = new Date().toISOString().split('T')[0];
  const bookingDate = new Date(booking.bookingDate).toISOString().split('T')[0];
  const nowHour = new Date().getHours();
  const nowMin  = new Date().getMinutes();
  const nowTotal = nowHour * 60 + nowMin;
  const startTotal = parseInt(booking.timeStart.split(':')[0]) * 60
    + parseInt(booking.timeStart.split(':')[1]);
 
  if (bookingDate !== today) {
    throw new BadRequestException(
      `Booking này dành cho ngày ${bookingDate}, hôm nay là ${today}`
    );
  }
 
  if (nowTotal < startTotal - 30) {
    throw new BadRequestException(
      `Chưa đến giờ check-in. Giờ chơi: ${booking.timeStart} (check-in sớm nhất 30 phút trước)`
    );
  }
 
  // 4. Cập nhật status → playing
  const updated = await this.prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'playing', updatedAt: new Date() },
    include: {
      court: { include: { branch: true } },
      user: true,
    },
  });
 
  return {
    success: true,
    message: 'Check-in thành công!',
    booking: {
      id: updated.id,
      customerName: updated.customerName || updated.user?.fullName,
      customerPhone: updated.customerPhone,
      courtName: updated.court.name,
      branchName: updated.court.branch.name,
      bookingDate: updated.bookingDate,
      timeStart: updated.timeStart,
      timeEnd: updated.timeEnd,
      amount: updated.amount,
      status: updated.status,
    },
  };
  }
}