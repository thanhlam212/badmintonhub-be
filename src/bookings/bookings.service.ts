import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateBookingDto,
  FixedScheduleAdjustDto,
  FixedScheduleConfirmDto,
  FixedSchedulePreviewDto,
  UpdateBookingStatusDto,
} from './dto/booking.dto';
import { EmailService } from '../email/email.service';

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  private validateFixedSchedule(dto: FixedSchedulePreviewDto | FixedScheduleConfirmDto) {
  const start = this.normalizeDate(dto.startDate);
  const end = this.normalizeDate(dto.endDate);
  const today = this.normalizeDate(new Date());

  // Ngày bắt đầu phải >= hôm nay
  if (start < today) {
    throw new BadRequestException('Ngày bắt đầu phải từ hôm nay trở đi');
  }

  // Ngày kết thúc phải sau ngày bắt đầu
  if (end <= start) {
    throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
  }

  // Khoảng thời gian tối thiểu
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  
  if (dto.cycle === 'weekly') {
    // Gói tuần tối thiểu 4 tuần (28 ngày)
    if (daysDiff < 28) {
      throw new BadRequestException('Gói theo tuần tối thiểu 4 tuần (28 ngày)');
    }
  } else if (dto.cycle === 'monthly') {
    // Gói tháng tối thiểu 2 tháng (60 ngày)
    if (daysDiff < 60) {
      throw new BadRequestException('Gói theo tháng tối thiểu 2 tháng (60 ngày)');
    }
  }

  // Khoảng thời gian tối đa: 1 năm
  if (daysDiff > 365) {
    throw new BadRequestException('Gói cố định tối đa 1 năm (365 ngày)');
  }

  // Kiểm tra giờ hợp lệ
  const startHour = parseInt(dto.timeStart.split(':')[0]);
  const endHour = parseInt(dto.timeEnd.split(':')[0]);
  
  if (endHour <= startHour) {
    throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu');
  }

  if (endHour - startHour > 4) {
    throw new BadRequestException('Mỗi buổi tối đa 4 giờ liên tiếp');
  }
}

/**
 * ✨ MỚI: Tính giá cho Fixed Schedule (có thể áp dụng discount)
 */
private calculateFixedSchedulePrice(
  basePrice: number,
  hoursPerSession: number,
  totalSessions: number,
  discountRate: number = 0,
): { 
  pricePerHour: number;
  pricePerSession: number;
  totalAmount: number;
  discountAmount: number;
  finalAmount: number;
} {
  const pricePerSession = Number(basePrice) * hoursPerSession;
  const totalAmount = pricePerSession * totalSessions;
  const discountAmount = Math.floor(totalAmount * discountRate);
  const finalAmount = totalAmount - discountAmount;

  return {
    pricePerHour: Number(basePrice),
    pricePerSession,
    totalAmount,
    discountAmount,
    finalAmount,
  };
}

  private normalizeDate(value: string | Date) {
    const date = value instanceof Date ? new Date(value) : new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private formatDate(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private dayLabel(date: Date) {
    return `${date.getDate()}/${date.getMonth() + 1}`;
  }

  private buildHourSlots(timeStart: string, timeEnd: string) {
    const startHour = parseInt(timeStart.split(':')[0]);
    const endHour = parseInt(timeEnd.split(':')[0]);
    if (endHour <= startHour) throw new BadRequestException('Gio ket thuc phai sau gio bat dau');
    if (endHour - startHour > 4) throw new BadRequestException('Toi da chi duoc dat 4 gio lien tiep');
    return Array.from({ length: endHour - startHour }, (_, i) => `${String(startHour + i).padStart(2, '0')}:00`);
  }

  private generateFixedDates(dto: FixedSchedulePreviewDto) {
    const start = this.normalizeDate(dto.startDate);
    const end = this.normalizeDate(dto.endDate);
    if (end < start) throw new BadRequestException('Ngay ket thuc phai sau ngay bat dau');

    const dates: Date[] = [];
    const current = new Date(start);
    while (current <= end) {
      dates.push(new Date(current));
      if (dto.cycle === 'weekly') {
        current.setDate(current.getDate() + 7);
      } else {
        const day = current.getDate();
        current.setMonth(current.getMonth() + 1);
        if (current.getDate() !== day) current.setDate(0);
      }
    }
    return dates;
  }

  private async checkSlotConflict(client: any, courtId: number, date: Date, slots: string[]) {
    return client.courtSlot.findMany({
      where: {
        courtId,
        slotDate: date,
        time: { in: slots },
        status: { in: ['booked', 'hold'] },
      },
      select: { id: true, time: true, status: true, bookedBy: true, bookingId: true },
    });
  }

  private invoiceCode(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
  }

  async create(dto: CreateBookingDto) {
    const hours = this.buildHourSlots(dto.timeStart, dto.timeEnd);
    const dateObj = this.normalizeDate(dto.bookingDate);

    return this.prisma.$transaction(async (tx) => {
      const court = await tx.court.findUnique({
        where: { id: dto.courtId },
        select: { id: true, price: true, branchId: true, available: true, name: true },
      });
      if (!court) throw new NotFoundException('San khong ton tai');
      if (!court.available) throw new BadRequestException('San hien dang dong cua');

      const conflictSlots = await this.checkSlotConflict(tx, dto.courtId, dateObj, hours);
      if (conflictSlots.length > 0) {
        throw new ConflictException(`San da duoc dat vao luc: ${conflictSlots.map((s) => s.time).join(', ')}`);
      }

      const amount = Number(court.price) * hours.length;
      const booking = await tx.booking.create({
        data: {
          courtId: dto.courtId,
          branchId: court.branchId,
          bookingDate: dateObj,
          dayLabel: this.dayLabel(dateObj),
          timeStart: dto.timeStart,
          timeEnd: dto.timeEnd,
          amount,
          pricePerHour: court.price,
          people: dto.people || 2,
          paymentMethod: dto.paymentMethod,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail || null,
          userId: dto.userId || null,
          status: 'pending',
        },
      });

      await tx.courtSlot.createMany({
        data: hours.map((time) => ({
          courtId: dto.courtId,
          slotDate: dateObj,
          dateLabel: this.dayLabel(dateObj),
          time,
          status: 'hold',
          bookedBy: dto.customerName,
          phone: dto.customerPhone,
          bookingId: booking.id,
        })),
      });

      await tx.invoice.create({
        data: {
          code: this.invoiceCode('BK'),
          bookingId: booking.id,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail || null,
          subtotalSnapshot: amount,
          totalSnapshot: amount,
          paymentMethod: dto.paymentMethod,
          status: dto.paymentMethod === 'cash' ? 'unpaid' : 'paid',
          items: {
            create: [{
              description: `Dat san ${court.name} ${this.formatDate(dateObj)} ${dto.timeStart}-${dto.timeEnd}`,
              quantity: hours.length,
              unitPriceSnapshot: court.price,
              lineTotalSnapshot: amount,
            }],
          },
        },
      });

      return { ...booking, slots: hours, amount, court: { name: court.name } };
    });
  }

async previewFixedSchedule(dto: FixedSchedulePreviewDto) {
  this.validateFixedSchedule(dto);

  const hours = this.buildHourSlots(dto.timeStart, dto.timeEnd);
  const dates = this.generateFixedDates(dto);
  
  if (dates.length === 0) {
    throw new BadRequestException('Không có buổi nào trong khoảng ngày đã chọn');
  }

  const court = await this.prisma.court.findUnique({
    where: { id: dto.courtId },
    select: { 
      id: true, 
      name: true, 
      price: true, 
      available: true, 
      branchId: true,
      type: true,
    },
  });

  if (!court) throw new NotFoundException('Sân không tồn tại');
  if (!court.available) throw new BadRequestException('Sân hiện đang đóng cửa');

  const occurrences = await Promise.all(
    dates.map(async (date) => {
      const conflicts = await this.checkSlotConflict(
        this.prisma,
        dto.courtId,
        date,
        hours,
      );
      
      return {
        date: this.formatDate(date),
        dayLabel: this.dayLabel(date),
        courtId: dto.courtId,
        courtName: court.name,
        timeStart: dto.timeStart,
        timeEnd: dto.timeEnd,
        slots: hours,
        available: conflicts.length === 0,
        conflicts: conflicts.map(c => ({ // ✨ Format conflicts
          time: c.time,
          status: c.status,
          bookedBy: c.bookedBy,
        })),
        pricePerHour: Number(court.price),
        amount: Number(court.price) * hours.length,
        skip: false,
      };
    }),
  );

  const availableOccurrences = occurrences.filter((o) => o.available);
  const conflictOccurrences = occurrences.filter((o) => !o.available);

  // ✨ Tính toán pricing (giảm giá mặc định cho gói dài hạn)
  let suggestedDiscount = 0;
  if (dto.cycle === 'weekly' && dates.length >= 12) {
    suggestedDiscount = 0.05; // Giảm 5% cho gói >= 12 tuần
  } else if (dto.cycle === 'monthly' && dates.length >= 6) {
    suggestedDiscount = 0.10; // Giảm 10% cho gói >= 6 tháng
  }

  const pricing = this.calculateFixedSchedulePrice(
    Number(court.price),
    hours.length,
    availableOccurrences.length,
    suggestedDiscount,
  );

  return {
    court: {
      id: court.id,
      name: court.name,
      type: court.type,
      price: Number(court.price),
    },
    cycle: dto.cycle,
    startDate: this.formatDate(this.normalizeDate(dto.startDate)),
    endDate: this.formatDate(this.normalizeDate(dto.endDate)),
    hoursPerSession: hours.length,
    
    // ✨ Thống kê
    occurrences,
    totalOccurrences: occurrences.length,
    availableOccurrences: availableOccurrences.length,
    conflictOccurrences: conflictOccurrences.length,
    
    // ✨ Pricing chi tiết
    pricing: {
      pricePerHour: pricing.pricePerHour,
      pricePerSession: pricing.pricePerSession,
      totalSessions: availableOccurrences.length,
      subtotal: pricing.totalAmount,
      suggestedDiscount: suggestedDiscount,
      discountAmount: pricing.discountAmount,
      finalAmount: pricing.finalAmount,
    },
    
    // ✨ Gợi ý điều chỉnh
    suggestions: {
      hasConflicts: conflictOccurrences.length > 0,
      message: conflictOccurrences.length > 0
        ? `Có ${conflictOccurrences.length} buổi bị trùng lịch. Vui lòng điều chỉnh hoặc bỏ qua các buổi này.`
        : 'Tất cả các buổi đều khả dụng!',
    },
  };
}

  async confirmFixedSchedule(dto: FixedScheduleConfirmDto) {
  // ✨ Validation
  this.validateFixedSchedule(dto);

  const selected = (dto.occurrences || []).filter((o) => !o.skip);
  if (!selected.length) {
    throw new BadRequestException('Cần chọn ít nhất 1 buổi hợp lệ');
  }

  return this.prisma.$transaction(async (tx) => {
    const court = await tx.court.findUnique({
      where: { id: dto.courtId },
      select: { id: true, name: true, price: true, branchId: true, available: true },
    });

    if (!court) throw new NotFoundException('Sân không tồn tại');
    if (!court.available) throw new BadRequestException('Sân hiện đang đóng cửa');

    const hours = this.buildHourSlots(dto.timeStart, dto.timeEnd);
    
    // ✨ Tính toán giá với discount
    const discountRate = dto.discountRate || 0;
    const pricing = this.calculateFixedSchedulePrice(
      Number(court.price),
      hours.length,
      selected.length,
      discountRate,
    );

    // ✨ Tạo Fixed Schedule với adjustmentLimit tùy chỉnh
    const adjustmentLimit = dto.adjustmentLimit !== undefined 
      ? dto.adjustmentLimit 
      : (dto.cycle === 'monthly' ? 2 : 1); // Default: 2 lần/tháng, 1 lần/tuần

    const fixedSchedule = await tx.fixedSchedule.create({
      data: {
        userId: dto.userId || null,
        courtId: dto.courtId,
        cycle: dto.cycle,
        startDate: this.normalizeDate(dto.startDate),
        endDate: this.normalizeDate(dto.endDate),
        timeStart: dto.timeStart,
        timeEnd: dto.timeEnd,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        customerEmail: dto.customerEmail || null,
        paymentMethod: dto.paymentMethod,
        pricePerHourSnapshot: pricing.pricePerHour,
        totalAmountSnapshot: pricing.finalAmount,
        occurrenceCount: selected.length,
        adjustmentLimit, // ✨ Sử dụng giá trị tùy chỉnh
        adjustmentUsed: 0,
        status: dto.paymentMethod === 'cash' ? 'pending' : 'deposited',
      },
    });

    // Tạo occurrences và bookings
    const occurrenceResults = await Promise.all(
      selected.map(async (occ) => {
        const occDate = this.normalizeDate(occ.date);
        
        // Sử dụng adjustedCourtId, adjustedTimeStart nếu có
        const finalCourtId = occ.adjustedCourtId || occ.courtId;
        const finalTimeStart = occ.adjustedTimeStart || occ.timeStart;
        const finalTimeEnd = occ.adjustedTimeEnd || occ.timeEnd;
        const finalHours = this.buildHourSlots(finalTimeStart, finalTimeEnd);

        // Kiểm tra conflict lần cuối
        const conflicts = await this.checkSlotConflict(tx, finalCourtId, occDate, finalHours);
        if (conflicts.length > 0) {
          throw new ConflictException(
            `Buổi ${occ.dayLabel} bị trùng lịch: ${conflicts.map(c => c.time).join(', ')}`,
          );
        }

        // Lấy thông tin sân (có thể khác sân gốc nếu đã adjust)
        const occCourt = finalCourtId === dto.courtId 
          ? court 
          : await tx.court.findUnique({
              where: { id: finalCourtId },
              select: { id: true, name: true, price: true, branchId: true },
            });

        if (!occCourt) throw new NotFoundException(`Sân ID ${finalCourtId} không tồn tại`);

        const amount = Number(occCourt.price) * finalHours.length;

        // Tạo occurrence
        const occurrence = await tx.fixedScheduleOccurrence.create({
          data: {
            fixedScheduleId: fixedSchedule.id,
            courtId: finalCourtId,
            occurrenceDate: occDate,
            dayLabel: this.dayLabel(occDate),
            timeStart: finalTimeStart,
            timeEnd: finalTimeEnd,
            pricePerHourSnapshot: occCourt.price,
            amountSnapshot: amount,
            status: 'scheduled',
          },
        });

        // Tạo booking
        const booking = await tx.booking.create({
          data: {
            courtId: finalCourtId,
            branchId: occCourt.branchId,
            bookingDate: occDate,
            dayLabel: this.dayLabel(occDate),
            timeStart: finalTimeStart,
            timeEnd: finalTimeEnd,
            amount,
            pricePerHour: occCourt.price,
            people: 2,
            paymentMethod: dto.paymentMethod,
            customerName: dto.customerName,
            customerPhone: dto.customerPhone,
            customerEmail: dto.customerEmail || null,
            userId: dto.userId || null,
            status: dto.paymentMethod === 'cash' ? 'pending' : 'confirmed',
            fixedScheduleId: fixedSchedule.id,
            fixedOccurrenceId: occurrence.id,
          },
        });

        // Tạo slots
        await tx.courtSlot.createMany({
          data: finalHours.map((time) => ({
            courtId: finalCourtId,
            slotDate: occDate,
            dateLabel: this.dayLabel(occDate),
            time,
            status: dto.paymentMethod === 'cash' ? 'hold' : 'booked',
            bookedBy: dto.customerName,
            phone: dto.customerPhone,
            bookingId: booking.id,
          })),
        });

        return { occurrence, booking };
      }),
    );

    // ✨ Tạo invoice tổng hợp
    await tx.invoice.create({
      data: {
        code: this.invoiceCode('FS'), // FS = Fixed Schedule
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        customerEmail: dto.customerEmail || null,
        subtotalSnapshot: pricing.totalAmount,
        totalSnapshot: pricing.finalAmount,
        paymentMethod: dto.paymentMethod,
        status: dto.paymentMethod === 'cash' ? 'unpaid' : 'deposited',
        items: {
          create: [{
            description: `Gói đặt sân cố định ${dto.cycle === 'weekly' ? 'hàng tuần' : 'hàng tháng'} - ${court.name} (${selected.length} buổi)`,
            quantity: selected.length,
            unitPriceSnapshot: pricing.pricePerSession,
            lineTotalSnapshot: pricing.finalAmount,
          }],
        },
      },
    });

    return {
      success: true,
      fixedSchedule: {
        id: fixedSchedule.id,
        courtName: court.name,
        cycle: dto.cycle,
        occurrenceCount: selected.length,
        adjustmentLimit,
        pricing,
      },
      occurrences: occurrenceResults.map(r => ({
        id: r.occurrence.id,
        bookingId: r.booking.id,
        date: this.formatDate(r.occurrence.occurrenceDate),
        timeStart: r.occurrence.timeStart,
        timeEnd: r.occurrence.timeEnd,
      })),
    };
  });
}

  async confirm(id: string) {
    const booking = await this.findOne(id);
    if (booking.status !== 'pending' && booking.status !== 'deposited') {
      throw new BadRequestException(`Khong the xac nhan booking dang o trang thai ${booking.status}`);
    }
    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'confirmed',
        slots: { updateMany: { where: {}, data: { status: 'booked' } } },
      },
      include: { court: { include: { branch: true } }, user: true },
    });

    const email = updated.customerEmail || updated.user?.email;
    if (email) {
      await this.emailService.sendBookingConfirmed({
        id: updated.id,
        customerName: updated.customerName || updated.user?.fullName || 'Quy khach',
        customerEmail: email,
        courtName: updated.court.name,
        branchName: updated.court.branch?.name ?? '',
        bookingDate: updated.bookingDate.toISOString(),
        timeStart: updated.timeStart ?? '',
        timeEnd: updated.timeEnd ?? '',
        amount: parseFloat(String(updated.amount)),
      });
    }

    return { success: true, booking: updated };
  }

  async startPlaying(id: string) {
    const booking = await this.findOne(id);
    if (booking.status !== 'confirmed') throw new BadRequestException(`Khong the check-in booking ${booking.status}`);
    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: 'playing' },
      include: { court: { include: { branch: true } }, user: true },
    });
    return { success: true, booking: updated };
  }

  async complete(id: string) {
    const booking = await this.findOne(id);
    if (booking.status !== 'playing') throw new BadRequestException(`Khong the hoan thanh booking ${booking.status}`);
    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: 'completed' },
      include: { court: { include: { branch: true } }, user: true },
    });
    return { success: true, booking: updated };
  }

  async cancel(id: string) {
    const booking = await this.findOne(id);
    if (['completed', 'cancelled'].includes(booking.status)) throw new BadRequestException('Khong the huy booking nay');

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'cancelled',
        slots: { deleteMany: {} },
        ...(booking.fixedOccurrenceId ? { fixedOccurrence: { update: { status: 'cancelled' } } } : {}),
      },
      include: { court: { include: { branch: true } }, user: true },
    });
    return { success: true, booking: updated };
  }

  async updateStatus(id: string, dto: UpdateBookingStatusDto) {
    const booking = await this.findOne(id);
    const validTransitions: Record<string, string[]> = {
      pending: ['deposited', 'confirmed', 'cancelled'],
      deposited: ['confirmed', 'cancelled'],
      confirmed: ['playing', 'cancelled'],
      playing: ['completed'],
      completed: [],
      cancelled: [],
    };
    if (!validTransitions[booking.status]?.includes(dto.status)) {
      throw new BadRequestException(`Khong the chuyen tu ${booking.status} sang ${dto.status}`);
    }
    switch (dto.status) {
      case 'deposited':
        return {
          success: true,
          booking: await this.prisma.booking.update({ where: { id }, data: { status: 'deposited' } }),
        };
      case 'confirmed': return this.confirm(id);
      case 'playing': return this.startPlaying(id);
      case 'completed': return this.complete(id);
      case 'cancelled': return this.cancel(id);
    }
  }

  async findAll(filters: { branchId?: number; courtId?: number; date?: string; status?: string; phone?: string }) {
    return this.prisma.booking.findMany({
      where: {
        ...(filters.branchId && { branchId: filters.branchId }),
        ...(filters.courtId && { courtId: filters.courtId }),
        ...(filters.date && { bookingDate: this.normalizeDate(filters.date) }),
        ...(filters.status && { status: filters.status as any }),
        ...(filters.phone && { customerPhone: { contains: filters.phone } }),
      },
      include: {
        court: { select: { name: true, type: true } },
        branch: { select: { name: true } },
        user: { select: { fullName: true, phone: true } },
      },
      orderBy: [{ bookingDate: 'desc' }, { timeStart: 'asc' }],
    });
  }

  async findByUser(userId: string) {
    return this.prisma.booking.findMany({
      where: { userId },
      include: {
        court: { select: { name: true, image: true, type: true, price: true } },
        branch: { select: { name: true, address: true } },
        slots: { select: { time: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        court: { include: { amenities: true } },
        branch: true,
        user: { select: { fullName: true, email: true, phone: true } },
        slots: { orderBy: { time: 'asc' } },
        invoices: { include: { items: true } },
      },
    });
    if (!booking) throw new NotFoundException(`Booking #${id} khong ton tai`);
    return booking;
  }

  async findOneForUser(id: string, user: any) {
    const booking = await this.findOne(id);
    if (user.role === 'admin' || user.role === 'employee') return booking;
    if (booking.userId && booking.userId === user.id) return booking;
    throw new ForbiddenException('Ban khong co quyen xem booking nay');
  }

  async cancelForUser(id: string, user: any) {
    const booking = await this.findOne(id);
    if (!(user.role === 'admin' || user.role === 'employee' || (booking.userId && booking.userId === user.id))) {
      throw new ForbiddenException('Ban khong co quyen huy booking nay');
    }
    return this.cancel(id);
  }

  async getTodayBookings(branchId?: number) {
    const today = this.normalizeDate(new Date());
    return this.prisma.booking.findMany({
      where: {
        bookingDate: today,
        status: { in: ['confirmed', 'playing'] },
        ...(branchId && { branchId }),
      },
      include: {
        court: { select: { name: true, type: true } },
        branch: { select: { name: true } },
      },
      orderBy: { timeStart: 'asc' },
    });
  }

  async checkin(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { court: { include: { branch: true } }, user: true },
    });
    if (!booking) throw new NotFoundException('Khong tim thay booking');
    if (booking.status === 'playing') throw new BadRequestException('Khach da check-in roi');
    if (booking.status === 'completed') throw new BadRequestException('Booking da hoan thanh');
    if (booking.status === 'cancelled') throw new BadRequestException('Booking da bi huy');
    if (booking.status === 'pending' || booking.status === 'deposited') throw new BadRequestException('Booking chua duoc xac nhan thanh toan');

    const today = this.formatDate(new Date());
    const bookingDate = this.formatDate(booking.bookingDate);
    const now = new Date();
    const nowTotal = now.getHours() * 60 + now.getMinutes();
    const startTotal = parseInt(booking.timeStart.split(':')[0]) * 60 + parseInt(booking.timeStart.split(':')[1]);

    if (bookingDate !== today) throw new BadRequestException(`Booking nay danh cho ngay ${bookingDate}, hom nay la ${today}`);
    if (nowTotal < startTotal - 30) throw new BadRequestException(`Chua den gio check-in. Gio choi: ${booking.timeStart}`);

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'playing', updatedAt: new Date() },
      include: { court: { include: { branch: true } }, user: true },
    });

    return {
      success: true,
      message: 'Check-in thanh cong',
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

  async adjustFixedOccurrence(scheduleId: string, occurrenceId: string, dto: FixedScheduleAdjustDto, user: any) {
    return this.prisma.$transaction(async (tx) => {
      const schedule = await tx.fixedSchedule.findUnique({
        where: { id: scheduleId },
        include: { occurrences: true },
      });
      if (!schedule) throw new NotFoundException('Khong tim thay goi dat co dinh');
      if (!(user.role === 'admin' || user.role === 'employee' || (schedule.userId && schedule.userId === user.id))) {
        throw new ForbiddenException('Ban khong co quyen dieu chinh goi nay');
      }
      if (schedule.adjustmentUsed >= schedule.adjustmentLimit) {
        throw new BadRequestException('Da vuot qua so lan dieu chinh cho phep trong goi');
      }

      const occurrence = schedule.occurrences.find((o) => o.id === occurrenceId);
      if (!occurrence) throw new NotFoundException('Khong tim thay buoi trong goi');
      if (['cancelled', 'completed', 'skipped'].includes(occurrence.status)) {
        throw new BadRequestException('Buoi nay khong con co the dieu chinh');
      }

      const booking = await tx.booking.findUnique({
        where: { fixedOccurrenceId: occurrence.id },
        include: { slots: true },
      });
      if (!booking) throw new NotFoundException('Khong tim thay booking cua buoi nay');

      if (dto.type === 'skip') {
        await tx.courtSlot.deleteMany({ where: { bookingId: booking.id } });
        await tx.booking.update({ where: { id: booking.id }, data: { status: 'cancelled' } });
        await tx.fixedScheduleOccurrence.update({ where: { id: occurrence.id }, data: { status: 'skipped' } });
      } else {
        const newCourtId = dto.newCourtId ?? occurrence.courtId;
        const newDate = this.normalizeDate(dto.newDate || occurrence.occurrenceDate);
        const newTimeStart = dto.newTimeStart || occurrence.timeStart;
        const newTimeEnd = dto.newTimeEnd || occurrence.timeEnd;
        const hours = this.buildHourSlots(newTimeStart, newTimeEnd);
        const newCourt = await tx.court.findUnique({
          where: { id: newCourtId },
          select: { id: true, branchId: true, price: true, name: true, available: true },
        });
        if (!newCourt || !newCourt.available) throw new BadRequestException('San moi khong kha dung');

        const conflicts = await this.checkSlotConflict(tx, newCourtId, newDate, hours);
        const conflictsExcludingCurrent = conflicts.filter((slot) =>
          !booking.slots.some((current) =>
            current.courtId === newCourtId &&
            this.formatDate(current.slotDate) === this.formatDate(newDate) &&
            current.time === slot.time
          )
        );
        if (conflictsExcludingCurrent.length > 0) {
          throw new ConflictException(`Khung gio moi bi trung: ${conflictsExcludingCurrent.map((c) => c.time).join(', ')}`);
        }

        const amount = Number(newCourt.price) * hours.length;
        await tx.courtSlot.deleteMany({ where: { bookingId: booking.id } });
        await tx.fixedScheduleOccurrence.update({
          where: { id: occurrence.id },
          data: {
            courtId: newCourtId,
            occurrenceDate: newDate,
            timeStart: newTimeStart,
            timeEnd: newTimeEnd,
            pricePerHourSnapshot: newCourt.price,
            amountSnapshot: amount,
            status: 'rescheduled',
          },
        });
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            courtId: newCourtId,
            branchId: newCourt.branchId,
            bookingDate: newDate,
            dayLabel: this.dayLabel(newDate),
            timeStart: newTimeStart,
            timeEnd: newTimeEnd,
            pricePerHour: newCourt.price,
            amount,
          },
        });
        await tx.courtSlot.createMany({
          data: hours.map((time) => ({
            courtId: newCourtId,
            slotDate: newDate,
            dateLabel: this.dayLabel(newDate),
            time,
            status: booking.status === 'confirmed' ? 'booked' : 'hold',
            bookedBy: booking.customerName,
            phone: booking.customerPhone,
            bookingId: booking.id,
          })),
        });
      }

      await tx.fixedScheduleAdjustment.create({
        data: {
          fixedScheduleId: schedule.id,
          occurrenceId: occurrence.id,
          type: dto.type,
          oldCourtId: occurrence.courtId,
          oldDate: occurrence.occurrenceDate,
          oldTimeStart: occurrence.timeStart,
          oldTimeEnd: occurrence.timeEnd,
          newCourtId: dto.newCourtId || null,
          newDate: dto.newDate ? this.normalizeDate(dto.newDate) : null,
          newTimeStart: dto.newTimeStart || null,
          newTimeEnd: dto.newTimeEnd || null,
          note: dto.note || null,
        },
      });

      const updatedSchedule = await tx.fixedSchedule.update({
        where: { id: schedule.id },
        data: { adjustmentUsed: { increment: 1 } },
        include: { occurrences: true, adjustments: true },
      });
      return { success: true, fixedSchedule: updatedSchedule };
    });
  }
}
