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
  FixedAdjustmentType,
  UpdateBookingStatusDto,
  CheckSlotDto,
} from './dto/booking.dto';
import { EmailService } from '../email/email.service';
import { FixedScheduleService } from './fixed-schedule.service';
import {
  normalizeDate,
  formatDate,
  dayLabel,
  buildHourSlots,
  invoiceCode,
  checkSlotConflict,
} from './booking.helpers';

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private fixedScheduleService: FixedScheduleService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // BOOKING THƯỜNG: CREATE
  // ═══════════════════════════════════════════════════════════════

  async create(dto: CreateBookingDto) {
    const hours = buildHourSlots(dto.timeStart, dto.timeEnd);
    const dateObj = normalizeDate(dto.bookingDate);

    return this.prisma.$transaction(async (tx) => {
      const court = await tx.court.findUnique({
        where: { id: dto.courtId },
        select: {
          id: true,
          price: true,
          branchId: true,
          available: true,
          name: true,
        },
      });
      if (!court) throw new NotFoundException('Sân không tồn tại');
      if (!court.available) {
        throw new BadRequestException('Sân hiện đang đóng cửa');
      }

      const conflictSlots = await checkSlotConflict(
        tx,
        dto.courtId,
        dateObj,
        hours,
      );
      if (conflictSlots.length > 0) {
        throw new ConflictException(
          `Sân đã được đặt vào lúc: ${conflictSlots.map((s) => s.time).join(', ')}`,
        );
      }

      const amount = Number(court.price) * hours.length;
      const booking = await tx.booking.create({
        data: {
          courtId: dto.courtId,
          branchId: court.branchId,
          bookingDate: dateObj,
          dayLabel: dayLabel(dateObj),
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
          dateLabel: dayLabel(dateObj),
          time,
          status: 'hold',
          bookedBy: dto.customerName,
          phone: dto.customerPhone,
          bookingId: booking.id,
        })),
      });

      await tx.invoice.create({
        data: {
          code: invoiceCode('BK'),
          bookingId: booking.id,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail || null,
          subtotalSnapshot: amount,
          totalSnapshot: amount,
          paymentMethod: dto.paymentMethod,
          status: dto.paymentMethod === 'cash' ? 'unpaid' : 'paid',
          items: {
            create: [
              {
                description: `Đặt sân ${court.name} ${formatDate(dateObj)} ${dto.timeStart}-${dto.timeEnd}`,
                quantity: hours.length,
                unitPriceSnapshot: court.price,
                lineTotalSnapshot: amount,
              },
            ],
          },
        },
      });

      return { ...booking, slots: hours, amount, court: { name: court.name } };
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // FIXED SCHEDULE: DELEGATE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Xem trước lịch cố định: sinh occurrences + check conflict + suggest replacement.
   * Delegate sang FixedScheduleService.
   */
  previewFixedSchedule(dto: FixedSchedulePreviewDto) {
    return this.fixedScheduleService.preview(dto);
  }

  /**
   * Confirm gói cố định: tạo FixedSchedule + Occurrences + Bookings + Invoice.
   * Delegate sang FixedScheduleService.
   */
  confirmFixedSchedule(dto: FixedScheduleConfirmDto) {
    return this.fixedScheduleService.confirm(dto);
  }

  /**
   * POST /bookings/fixed/check-slot
   * Kiểm tra 1 slot có available không - dùng trong modal "Đổi giờ" ở FE.
   * Trả về:
   * - available: true/false
   * - conflicts: danh sách slot đang bị đặt
   * - courts: danh sách sân cùng type còn trống (để user chọn)
   */
  async checkSlotAvailability(dto: CheckSlotDto) {
    const { courtId, date, timeStart, timeEnd } = dto;
    const dateObj = normalizeDate(date);
    const hours = buildHourSlots(timeStart, timeEnd);

    // Lấy thông tin sân để biết type + branchId
    const court = await this.prisma.court.findUnique({
      where: { id: courtId },
      select: { id: true, name: true, type: true, branchId: true, available: true },
    });
    if (!court) throw new NotFoundException('Sân không tồn tại');

    // Check conflict cho sân được chọn
    const conflicts = await checkSlotConflict(
      this.prisma, courtId, dateObj, hours,
    );

    // Lấy danh sách tất cả sân cùng type trong branch + check từng sân
    const sameCourts = await this.prisma.court.findMany({
      where: {
        branchId: court.branchId,
        type: court.type as any,
        available: true,
      },
      select: { id: true, name: true, type: true, price: true },
      orderBy: { id: 'asc' },
    });

    // Check availability cho từng sân
    const courtsWithAvailability = await Promise.all(
      sameCourts.map(async (c) => {
        const slotConflicts = await checkSlotConflict(
          this.prisma, c.id, dateObj, hours,
        );
        return {
          id: c.id,
          name: c.name,
          type: c.type,
          price: Number(c.price),
          available: slotConflicts.length === 0,
          isSelected: c.id === courtId,
        };
      }),
    );

    return {
      courtId,
      date: formatDate(dateObj),
      timeStart,
      timeEnd,
      available: conflicts.length === 0,
      conflicts,
      courts: courtsWithAvailability, // FE dùng để render danh sách sân
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // BOOKING: TRANSITIONS
  // ═══════════════════════════════════════════════════════════════

  async confirm(id: string) {
    const booking = await this.findOne(id);
    if (booking.status !== 'pending' && booking.status !== 'deposited') {
      throw new BadRequestException(
        `Không thể xác nhận booking đang ở trạng thái ${booking.status}`,
      );
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
        customerName:
          updated.customerName || updated.user?.fullName || 'Quý khách',
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
    if (booking.status !== 'confirmed') {
      throw new BadRequestException(
        `Không thể check-in booking ${booking.status}`,
      );
    }
    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: 'playing' },
      include: { court: { include: { branch: true } }, user: true },
    });
    return { success: true, booking: updated };
  }

  async complete(id: string) {
    const booking = await this.findOne(id);
    if (booking.status !== 'playing') {
      throw new BadRequestException(
        `Không thể hoàn thành booking ${booking.status}`,
      );
    }
    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: 'completed' },
      include: { court: { include: { branch: true } }, user: true },
    });
    return { success: true, booking: updated };
  }

  async cancel(id: string) {
    const booking = await this.findOne(id);
    if (['completed', 'cancelled'].includes(booking.status)) {
      throw new BadRequestException('Không thể hủy booking này');
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'cancelled',
        slots: { deleteMany: {} },
        ...(booking.fixedOccurrenceId
          ? { fixedOccurrence: { update: { status: 'cancelled' } } }
          : {}),
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
      throw new BadRequestException(
        `Không thể chuyển từ ${booking.status} sang ${dto.status}`,
      );
    }
    switch (dto.status) {
      case 'deposited':
        return {
          success: true,
          booking: await this.prisma.booking.update({
            where: { id },
            data: { status: 'deposited' },
          }),
        };
      case 'confirmed':
        return this.confirm(id);
      case 'playing':
        return this.startPlaying(id);
      case 'completed':
        return this.complete(id);
      case 'cancelled':
        return this.cancel(id);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // BOOKING: QUERIES
  // ═══════════════════════════════════════════════════════════════

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
        ...(filters.courtId && { courtId: filters.courtId }),
        ...(filters.date && { bookingDate: normalizeDate(filters.date) }),
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
    if (!booking) throw new NotFoundException(`Booking #${id} không tồn tại`);
    return booking;
  }

  async findOneForUser(id: string, user: any) {
    const booking = await this.findOne(id);
    if (user.role === 'admin' || user.role === 'employee') return booking;
    if (booking.userId && booking.userId === user.id) return booking;
    throw new ForbiddenException('Bạn không có quyền xem booking này');
  }

  async cancelForUser(id: string, user: any) {
    const booking = await this.findOne(id);
    if (
      !(
        user.role === 'admin' ||
        user.role === 'employee' ||
        (booking.userId && booking.userId === user.id)
      )
    ) {
      throw new ForbiddenException('Bạn không có quyền hủy booking này');
    }
    return this.cancel(id);
  }

  async getTodayBookings(branchId?: number) {
    const today = normalizeDate(new Date());
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
    if (!booking) throw new NotFoundException('Không tìm thấy booking');
    if (booking.status === 'playing') {
      throw new BadRequestException('Khách đã check-in rồi');
    }
    if (booking.status === 'completed') {
      throw new BadRequestException('Booking đã hoàn thành');
    }
    if (booking.status === 'cancelled') {
      throw new BadRequestException('Booking đã bị hủy');
    }
    if (booking.status === 'pending' || booking.status === 'deposited') {
      throw new BadRequestException('Booking chưa được xác nhận thanh toán');
    }

    const today = formatDate(new Date());
    const bookingDate = formatDate(booking.bookingDate);
    const now = new Date();
    const nowTotal = now.getHours() * 60 + now.getMinutes();
    const startTotal =
      parseInt(booking.timeStart.split(':')[0]) * 60 +
      parseInt(booking.timeStart.split(':')[1]);

    if (bookingDate !== today) {
      throw new BadRequestException(
        `Booking này dành cho ngày ${bookingDate}, hôm nay là ${today}`,
      );
    }
    if (nowTotal < startTotal - 30) {
      throw new BadRequestException(
        `Chưa đến giờ check-in. Giờ chơi: ${booking.timeStart}`,
      );
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'playing', updatedAt: new Date() },
      include: { court: { include: { branch: true } }, user: true },
    });

    return {
      success: true,
      message: 'Check-in thành công',
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

  // ═══════════════════════════════════════════════════════════════
  // FIXED SCHEDULE: QUERIES
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /bookings/fixed/my
   * Danh sách gói đặt cố định của user đang login.
   */
  async findMyFixedSchedules(userId: string) {
    const schedules = await this.prisma.fixedSchedule.findMany({
      where: { userId },
      include: {
        court: {
          select: {
            id: true,
            name: true,
            type: true,
            price: true,
            image: true,
            branch: { select: { id: true, name: true, address: true } },
          },
        },
        occurrences: {
          orderBy: { occurrenceDate: 'asc' },
          select: {
            id: true,
            occurrenceDate: true,
            dayLabel: true,
            timeStart: true,
            timeEnd: true,
            status: true,
            courtId: true,
            amountSnapshot: true,
          },
        },
        invoices: {
          select: {
            id: true,
            code: true,
            totalSnapshot: true,
            status: true,
            paymentMethod: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return schedules.map((s) => ({
      id: s.id,
      status: s.status,
      cycle: s.cycle,
      startDate: formatDate(s.startDate),
      endDate: formatDate(s.endDate),
      timeStart: s.timeStart,
      timeEnd: s.timeEnd,
      customerName: s.customerName,
      customerPhone: s.customerPhone,
      occurrenceCount: s.occurrenceCount,
      adjustmentLimit: s.adjustmentLimit,
      adjustmentUsed: s.adjustmentUsed,
      pricePerHourSnapshot: Number(s.pricePerHourSnapshot),
      totalAmountSnapshot: Number(s.totalAmountSnapshot),
      createdAt: s.createdAt,
      court: s.court,
      // Tóm tắt occurrences
      occurrenceSummary: {
        total: s.occurrences.length,
        scheduled: s.occurrences.filter((o) => o.status === 'scheduled').length,
        completed: s.occurrences.filter((o) => o.status === 'completed').length,
        skipped: s.occurrences.filter((o) => o.status === 'skipped').length,
        cancelled: s.occurrences.filter((o) => o.status === 'cancelled').length,
        upcoming: s.occurrences
          .filter((o) => o.status === 'scheduled' && o.occurrenceDate >= new Date())
          .slice(0, 3)
          .map((o) => ({
            id: o.id,
            date: formatDate(o.occurrenceDate),
            dayLabel: o.dayLabel,
            timeStart: o.timeStart,
            timeEnd: o.timeEnd,
            status: o.status,
          })),
      },
      invoice: s.invoices[0] || null,
    }));
  }

  /**
   * GET /bookings/fixed/:scheduleId
   * Chi tiết 1 gói đặt cố định (bao gồm toàn bộ occurrences).
   */
  async findFixedScheduleDetail(scheduleId: string, user: any) {
    const schedule = await this.prisma.fixedSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        court: {
          select: {
            id: true,
            name: true,
            type: true,
            price: true,
            image: true,
            branch: { select: { id: true, name: true, address: true } },
          },
        },
        occurrences: {
          orderBy: { occurrenceDate: 'asc' },
          include: {
            court: { select: { id: true, name: true } },
            booking: {
              select: { id: true, status: true, amount: true },
            },
          },
        },
        adjustments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            oldDate: true,
            newDate: true,
            oldCourtId: true,
            newCourtId: true,
            note: true,
            createdAt: true,
          },
        },
        invoices: {
          include: { items: true },
        },
      },
    });

    if (!schedule) throw new NotFoundException('Không tìm thấy gói đặt lịch');

    // Validate quyền truy cập
    const isOwner = schedule.userId === user.id;
    const isStaff = user.role === 'admin' || user.role === 'employee';
    if (!isOwner && !isStaff) {
      throw new ForbiddenException('Bạn không có quyền xem gói này');
    }

    return {
      id: schedule.id,
      status: schedule.status,
      cycle: schedule.cycle,
      startDate: formatDate(schedule.startDate),
      endDate: formatDate(schedule.endDate),
      timeStart: schedule.timeStart,
      timeEnd: schedule.timeEnd,
      customerName: schedule.customerName,
      customerPhone: schedule.customerPhone,
      customerEmail: schedule.customerEmail,
      paymentMethod: schedule.paymentMethod,
      occurrenceCount: schedule.occurrenceCount,
      adjustmentLimit: schedule.adjustmentLimit,
      adjustmentUsed: schedule.adjustmentUsed,
      pricePerHourSnapshot: Number(schedule.pricePerHourSnapshot),
      totalAmountSnapshot: Number(schedule.totalAmountSnapshot),
      createdAt: schedule.createdAt,
      court: schedule.court,
      occurrences: schedule.occurrences.map((o) => ({
        id: o.id,
        date: formatDate(o.occurrenceDate),
        dayLabel: o.dayLabel,
        timeStart: o.timeStart,
        timeEnd: o.timeEnd,
        status: o.status,
        courtId: o.courtId,
        courtName: o.court?.name || schedule.court.name,
        amountSnapshot: Number(o.amountSnapshot),
        bookingId: o.booking?.id || null,
        bookingStatus: o.booking?.status || null,
      })),
      adjustments: schedule.adjustments,
      invoice: schedule.invoices[0] || null,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // FIXED OCCURRENCE: ADJUST (sau khi đã confirm gói)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Khách đã mua gói, muốn điều chỉnh 1 buổi cụ thể (dùng quota adjustment).
   *
   * Lưu ý: method này sẽ được refactor sâu hơn ở Phase 5 (yêu cầu #3
   * trong roadmap - linh hoạt gói tháng). Hiện giữ logic cũ + chỉ
   * cập nhật để dùng helpers shared.
   */
  async adjustFixedOccurrence(
    scheduleId: string,
    occurrenceId: string,
    dto: FixedScheduleAdjustDto,
    user: any,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const schedule = await tx.fixedSchedule.findUnique({
        where: { id: scheduleId },
        include: { occurrences: true },
      });
      if (!schedule) throw new NotFoundException('Không tìm thấy gói đặt cố định');
      if (
        !(
          user.role === 'admin' ||
          user.role === 'employee' ||
          (schedule.userId && schedule.userId === user.id)
        )
      ) {
        throw new ForbiddenException('Bạn không có quyền điều chỉnh gói này');
      }
      if (schedule.adjustmentUsed >= schedule.adjustmentLimit) {
        throw new BadRequestException(
          'Đã vượt quá số lần điều chỉnh cho phép trong gói',
        );
      }

      const occurrence = schedule.occurrences.find((o) => o.id === occurrenceId);
      if (!occurrence) throw new NotFoundException('Không tìm thấy buổi trong gói');
      if (['cancelled', 'completed', 'skipped'].includes(occurrence.status)) {
        throw new BadRequestException('Buổi này không còn có thể điều chỉnh');
      }

      const booking = await tx.booking.findUnique({
        where: { fixedOccurrenceId: occurrence.id },
        include: { slots: true },
      });
      if (!booking) throw new NotFoundException('Không tìm thấy booking của buổi này');

      if (dto.type === FixedAdjustmentType.SKIP) {
        await tx.courtSlot.deleteMany({ where: { bookingId: booking.id } });
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: 'cancelled' },
        });
        await tx.fixedScheduleOccurrence.update({
          where: { id: occurrence.id },
          data: { status: 'skipped' },
        });
      } else {
        const newCourtId = dto.newCourtId ?? occurrence.courtId;
        const newDate = normalizeDate(dto.newDate || occurrence.occurrenceDate);
        const newTimeStart = dto.newTimeStart || occurrence.timeStart;
        const newTimeEnd = dto.newTimeEnd || occurrence.timeEnd;
        const hours = buildHourSlots(newTimeStart, newTimeEnd);
        const newCourt = await tx.court.findUnique({
          where: { id: newCourtId },
          select: {
            id: true,
            branchId: true,
            price: true,
            name: true,
            available: true,
          },
        });
        if (!newCourt || !newCourt.available) {
          throw new BadRequestException('Sân mới không khả dụng');
        }

        const conflicts = await checkSlotConflict(tx, newCourtId, newDate, hours);
        const conflictsExcludingCurrent = conflicts.filter(
          (slot) =>
            !booking.slots.some(
              (current) =>
                current.courtId === newCourtId &&
                formatDate(current.slotDate) === formatDate(newDate) &&
                current.time === slot.time,
            ),
        );
        if (conflictsExcludingCurrent.length > 0) {
          throw new ConflictException(
            `Khung giờ mới bị trùng: ${conflictsExcludingCurrent.map((c) => c.time).join(', ')}`,
          );
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
            dayLabel: dayLabel(newDate),
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
            dateLabel: dayLabel(newDate),
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
          newDate: dto.newDate ? normalizeDate(dto.newDate) : null,
          newTimeStart: dto.newTimeStart || null,
          newTimeEnd: dto.newTimeEnd || null,
          note: dto.reason || null,
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