import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CancelBookingDto,
  CreateBookingDto,
  CreateRecurringDto,
  UpdateServicesDto,
  FixedScheduleAdjustDto,
  FixedScheduleConfirmDto,
  FixedSchedulePreviewDto,
  FixedAdjustmentType,
  UpdateBookingStatusDto,
  UpdateFixedScheduleAdjustmentLimitDto,
  CheckSlotDto,
} from './dto/booking.dto';
import { EmailService } from '../email/email.service';
import { FixedScheduleService } from './fixed-schedule.service';
import {
  normalizeDate,
  formatDate,
  dayLabel,
  buildHourSlots,
  nextInvoiceCode,
  checkSlotConflict,
  assertSlotNotPast,
  getBusinessNowParts,
  HOLD_EXPIRES_MINUTES,
} from './booking.helpers';
import { normalizePaymentMethod } from '../common/payment-methods';

/** Thời gian giữ chỗ dùng chung cho thanh toán online. */
const HOLD_DURATION_MS = HOLD_EXPIRES_MINUTES * 60 * 1000;
const CHECKIN_EARLY_MINUTES = 15;
const CUSTOMER_ADJUST_REQUEST_PENDING = '[CUSTOMER_ADJUST_REQUEST_PENDING]';
const CUSTOMER_ADJUST_REQUEST_APPROVED = '[CUSTOMER_ADJUST_REQUEST_APPROVED]';
const CUSTOMER_ADJUST_REQUEST_REJECTED = '[CUSTOMER_ADJUST_REQUEST_REJECTED]';
const FIXED_ADJUST_MIN_NOTICE_HOURS = 72;
const FIXED_OCCURRENCE_QR_PREFIX = 'FIXED_OCCURRENCE:';

type CancelBookingOptions = {
  reason?: string | null;
  cancelledByName?: string | null;
  cancelledByRole?: string | null;
  cancelledAt?: Date;
  notify?: boolean;
};

@Injectable()
export class BookingsService implements OnModuleInit {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private fixedScheduleService: FixedScheduleService,
  ) {}

  private assertFixedOccurrenceAdjustNotice(occurrence: {
    occurrenceDate: Date;
    timeStart: string;
  }) {
    const dateToken = formatDate(occurrence.occurrenceDate);
    const [hourRaw, minuteRaw = '0'] = occurrence.timeStart.split(':');
    const startAt = new Date(`${dateToken}T${String(hourRaw).padStart(2, '0')}:${minuteRaw.padStart(2, '0')}:00+07:00`);
    const diffMs = startAt.getTime() - Date.now();
    if (diffMs < FIXED_ADJUST_MIN_NOTICE_HOURS * 60 * 60 * 1000) {
      throw new BadRequestException(
        'Yêu cầu đổi/hủy lịch cố định phải gửi trước ít nhất 3 ngày so với giờ bắt đầu buổi chơi.',
      );
    }
  }

  private buildFixedOccurrenceQrValue(occurrenceId: string) {
    return `${FIXED_OCCURRENCE_QR_PREFIX}${occurrenceId}`;
  }

  private parseFixedOccurrenceQrValue(value: string) {
    const raw = value.trim();
    if (raw.startsWith(FIXED_OCCURRENCE_QR_PREFIX)) {
      return raw.slice(FIXED_OCCURRENCE_QR_PREFIX.length);
    }
    if (raw.startsWith('FSO:')) {
      return raw.slice(4);
    }
    return null;
  }

  private isFixedOccurrenceCheckedIn(input: {
    occurrenceStatus?: string | null;
    bookingStatus?: string | null;
  }) {
    return (
      input.occurrenceStatus === 'completed' ||
      input.bookingStatus === 'playing' ||
      input.bookingStatus === 'completed'
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // AUTO-RELEASE: chạy mỗi 60 giây để giải phóng chỗ hết hạn
  // ═══════════════════════════════════════════════════════════════
  onModuleInit() {
    // Dọn dẹp ngay khi khởi động, sau đó mỗi 60 giây
    this.releaseAllExpiredBookings().catch(() => {})
    this.autoCompleteElapsedPlayingBookings().catch(() => {})
    setInterval(() => {
      this.releaseAllExpiredBookings().catch(() => {})
      this.autoCompleteElapsedPlayingBookings().catch(() => {})
    }, 60_000)
  }

  /** Giải phóng booking online pending quá hạn chưa thanh toán. */
  async releaseAllExpiredBookings() {
    const cutoff = new Date(Date.now() - HOLD_DURATION_MS)
    // Chỉ hủy booking thanh toán online timeout; cash/bank_transfer chờ nhân viên xác nhận tại quầy.
    const expired = await this.prisma.booking.findMany({
      where: {
        status:        'pending',
        paymentMethod: { in: ['vnpay', 'momo', 'sepay'] },
        createdAt:     { lt: cutoff },
      },
      select: { id: true, fixedScheduleId: true },
    })

    if (expired.length === 0) return

    const ids = expired.map(b => b.id)
    const fixedScheduleIds = [
      ...new Set(
        expired
          .map((booking) => booking.fixedScheduleId)
          .filter((id): id is string => Boolean(id)),
      ),
    ]
    await this.prisma.$transaction(async (tx) => {
      // Xóa CourtSlot (giải phóng giờ)
      await tx.courtSlot.deleteMany({ where: { bookingId: { in: ids } } })
      // Hủy invoice
      await tx.invoice.updateMany({
        where: {
          status: 'unpaid',
          OR: [
            { bookingId: { in: ids } },
            ...(fixedScheduleIds.length > 0
              ? [{ fixedScheduleId: { in: fixedScheduleIds } }]
              : []),
          ],
        },
        data: { status: 'cancelled' },
      })
      // Hủy booking
      await tx.booking.updateMany({
        where: { id: { in: ids }, status: 'pending' },
        data: { status: 'cancelled' },
      })

      if (fixedScheduleIds.length > 0) {
        const schedulesWithActiveBookings = await tx.fixedSchedule.findMany({
          where: {
            id: { in: fixedScheduleIds },
            bookings: { some: { status: { not: 'cancelled' } } },
          },
          select: { id: true },
        })
        const activeIds = new Set(
          schedulesWithActiveBookings.map((schedule) => schedule.id),
        )
        const cancelledScheduleIds = fixedScheduleIds.filter(
          (id) => !activeIds.has(id),
        )

        if (cancelledScheduleIds.length > 0) {
          await tx.fixedSchedule.updateMany({
            where: {
              id: { in: cancelledScheduleIds },
              status: 'pending',
            },
            data: { status: 'cancelled' },
          })
        }
      }
    })

    this.logger.log(`🗑️  Released ${ids.length} expired pending booking(s)`)
  }

  private timeToMinutes(time: string) {
    const [hour, minute] = time.split(':').map(Number)
    return hour * 60 + minute
  }

  private formatMinutesAsTime(totalMinutes: number) {
    const normalized = Math.max(0, totalMinutes)
    const hour = Math.floor(normalized / 60)
    const minute = normalized % 60
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }

  private assertCanCheckinNow(
    booking: { bookingDate: Date; timeStart?: string | null; timeEnd?: string | null },
    current = getBusinessNowParts(new Date()),
    options?: { allowElapsedCheckin?: boolean },
  ) {
    if (!booking.timeStart) {
      throw new BadRequestException('Booking chưa có giờ bắt đầu để check-in')
    }

    const bookingDate = formatDate(booking.bookingDate)
    if (bookingDate > current.dateToken) {
      throw new BadRequestException(
        `Booking này dành cho ngày ${bookingDate}, hôm nay là ${current.dateToken}`,
      )
    }

    if (bookingDate < current.dateToken) {
      if (options?.allowElapsedCheckin) return

      throw new BadRequestException(
        `Booking nÃ y dÃ nh cho ngÃ y ${bookingDate}, hÃ´m nay lÃ  ${current.dateToken}`,
      )
    }

    const startTotal = this.timeToMinutes(booking.timeStart)
    const earliestCheckin = startTotal - CHECKIN_EARLY_MINUTES
    if (current.minutes < earliestCheckin) {
      throw new BadRequestException(
        `Chỉ được check-in sớm tối đa ${CHECKIN_EARLY_MINUTES} phút. Vui lòng quay lại lúc ${this.formatMinutesAsTime(earliestCheckin)}.`,
      )
    }

    if (
      booking.timeEnd &&
      current.minutes >= this.timeToMinutes(booking.timeEnd) &&
      !options?.allowElapsedCheckin
    ) {
      throw new BadRequestException('Booking đã hết giờ, không thể check-in')
    }
  }

  private hasBookingElapsed(
    booking: { bookingDate: Date; timeEnd?: string | null },
    current: { dateToken: string; minutes: number },
  ) {
    if (!booking.timeEnd) return false

    const bookingDate = formatDate(booking.bookingDate)
    if (bookingDate < current.dateToken) return true
    if (bookingDate > current.dateToken) return false

    return current.minutes >= this.timeToMinutes(booking.timeEnd)
  }

  private normalizeCancellationReason(reason?: string | null) {
    const trimmed = reason?.trim()
    return trimmed ? trimmed : null
  }

  private isStaffUser(user?: { role?: string | null } | null) {
    return user?.role === 'admin' || user?.role === 'employee'
  }

  private getCancellerRoleLabel(role?: string | null) {
    switch (role) {
      case 'admin':
        return 'Admin'
      case 'employee':
        return 'Nhân viên'
      case 'user':
        return 'Khách hàng'
      default:
        return 'Hệ thống'
    }
  }

  private async sendBookingCancellationNotifications(booking: {
    id: string
    customerName?: string | null
    customerPhone?: string | null
    customerEmail?: string | null
    bookingDate: Date
    timeStart?: string | null
    timeEnd?: string | null
    amount: unknown
    cancellationReason?: string | null
    cancelledAt?: Date | null
    cancelledByName?: string | null
    cancelledByRole?: string | null
    court?: { name?: string | null; branch?: { name?: string | null } | null } | null
    branch?: { name?: string | null } | null
    user?: { email?: string | null } | null
  }) {
    const payload = {
      id: booking.id,
      customerName: booking.customerName || 'Quý khách',
      customerEmail: booking.customerEmail || booking.user?.email || '',
      customerPhone: booking.customerPhone || '',
      courtName: booking.court?.name || 'Sân cầu lông',
      branchName: booking.court?.branch?.name || booking.branch?.name || '',
      bookingDate: booking.bookingDate.toISOString(),
      timeStart: booking.timeStart || '',
      timeEnd: booking.timeEnd || '',
      amount: parseFloat(String(booking.amount ?? 0)),
      reason: this.normalizeCancellationReason(booking.cancellationReason),
      cancelledAt: booking.cancelledAt?.toISOString() || new Date().toISOString(),
      cancelledByName: booking.cancelledByName || 'Hệ thống',
      cancelledByRole: this.getCancellerRoleLabel(booking.cancelledByRole),
    }

    if (payload.customerEmail) {
      await this.emailService.sendBookingCancelledCustomer(payload)
    }

    const admins = await this.prisma.user.findMany({
      where: { role: 'admin' },
      select: { email: true },
    })

    const recipients = [...new Set(
      admins
        .map((admin) => admin.email?.trim())
        .filter((email): email is string => Boolean(email)),
    )]

    if (recipients.length > 0) {
      await this.emailService.sendBookingCancelledAdmin({
        ...payload,
        recipients,
      })
    }
  }

  private async autoCompleteElapsedPlayingBookings(filters?: {
    userId?: string
    bookingIds?: string[]
  }) {
    if (filters?.bookingIds && filters.bookingIds.length === 0) return new Set<string>()

    const current = getBusinessNowParts(new Date())
    const playingBookings = await this.prisma.booking.findMany({
      where: {
        status: 'playing',
        ...(filters?.userId ? { userId: filters.userId } : {}),
        ...(filters?.bookingIds ? { id: { in: filters.bookingIds } } : {}),
      },
      select: {
        id: true,
        bookingDate: true,
        timeEnd: true,
        fixedOccurrenceId: true,
      },
    })

    const elapsedBookings = playingBookings.filter((booking) =>
      this.hasBookingElapsed(booking, current),
    )

    if (elapsedBookings.length === 0) return new Set<string>()

    const bookingIds = elapsedBookings.map((booking) => booking.id)
    const fixedOccurrenceIds = elapsedBookings
      .map((booking) => booking.fixedOccurrenceId)
      .filter(Boolean) as string[]

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.updateMany({
        where: { id: { in: bookingIds } },
        data: { status: 'completed' },
      })

      if (fixedOccurrenceIds.length > 0) {
        await tx.fixedScheduleOccurrence.updateMany({
          where: {
            id: { in: fixedOccurrenceIds },
            status: { notIn: ['cancelled', 'completed', 'skipped'] },
          },
          data: { status: 'completed' },
        })
      }
    })

    this.logger.log(
      `✅ Auto-completed ${bookingIds.length} elapsed playing booking(s)`,
    )

    return new Set(bookingIds)
  }

  // ═══════════════════════════════════════════════════════════════
  // BOOKING THƯỜNG: CREATE
  // ═══════════════════════════════════════════════════════════════

  async create(dto: CreateBookingDto, user?: { role?: string | null }) {
    // FE gửi snake_case — đọc trực tiếp từ DTO
    const hours = buildHourSlots(dto.time_start, dto.time_end);
    const dateObj = normalizeDate(dto.booking_date);
    assertSlotNotPast(dateObj, dto.time_start);
    const paymentMethod = normalizePaymentMethod(dto.payment_method, 'cash');
    const isStaffBooking = this.isStaffUser(user)
    const bookingStatus = isStaffBooking ? 'confirmed' : 'pending'
    const slotStatus = isStaffBooking ? 'booked' : 'hold'
    const invoiceStatus = isStaffBooking ? 'paid' : 'unpaid'

    // Giải phóng hold hết hạn trước khi kiểm tra conflict.
    await this.releaseAllExpiredBookings().catch(() => {})

    const result = await this.prisma.$transaction(async (tx) => {
      const court = await tx.court.findUnique({
        where: { id: dto.court_id },
        include: { branch: { select: { name: true } } },
      });
      if (!court) throw new NotFoundException('Sân không tồn tại');
      if (!court.available) {
        throw new BadRequestException('Sân hiện đang đóng cửa');
      }

      const conflictSlots = await checkSlotConflict(
        tx,
        dto.court_id,
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
          courtId:       dto.court_id,
          branchId:      court.branchId,
          bookingDate:   dateObj,
          dayLabel:      dayLabel(dateObj),
          timeStart:     dto.time_start,
          timeEnd:       dto.time_end,
          amount,
          pricePerHour:  court.price,
          people:        dto.slots ?? dto.people ?? 2,
          paymentMethod,
          customerName:  dto.customer_name,
          customerPhone: dto.customer_phone,
          customerEmail: dto.customer_email || null,
          userId:        dto.user_id || null,
          status: bookingStatus,
        },
      });

      await tx.courtSlot.createMany({
        data: hours.map((time) => ({
          courtId:   dto.court_id,
          slotDate:  dateObj,
          dateLabel: dayLabel(dateObj),
          time,
          status:    slotStatus,
          bookedBy:  dto.customer_name,
          phone:     dto.customer_phone,
          bookingId: booking.id,
        })),
      });

      const invoice = await tx.invoice.create({
        data: {
          code:             await nextInvoiceCode(tx, 'MB'),
          bookingId:        booking.id,
          customerName:     dto.customer_name,
          customerPhone:    dto.customer_phone,
          customerEmail:    dto.customer_email || null,
          subtotalSnapshot: amount,
          totalSnapshot:    amount,
          paymentMethod,
          status:           invoiceStatus,
          items: {
            create: [
              {
                description:       `Đặt sân ${court.name} ${formatDate(dateObj)} ${dto.time_start}-${dto.time_end}`,
                quantity:          hours.length,
                unitPriceSnapshot: court.price,
                lineTotalSnapshot: amount,
              },
            ],
          },
        },
      });

      return {
        ...booking,
        invoiceId:   invoice.id,
        invoiceCode: invoice.code,
        invoiceStatus: invoice.status,
        slots:       hours,
        amount,
        court:       { name: court.name },
        branch:      { name: court.branch?.name || '' },
      };
    });

    // Gửi email xác nhận kèm QR check-in ngay sau khi tạo booking (fire-and-forget)
    const customerEmail = dto.customer_email || null;
    if (customerEmail) {
      this.emailService.sendBookingConfirmed({
        id:            result.id,
        customerName:  dto.customer_name,
        customerEmail,
        courtName:     result.court.name,
        branchName:    result.branch.name,
        bookingDate:   dto.booking_date,
        timeStart:     dto.time_start,
        timeEnd:       dto.time_end,
        amount:        result.amount,
        invoiceCode:   result.invoiceCode,
        paymentMethod,
      }).catch(() => {/* fire-and-forget */});
    }

    return result;
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
  confirmFixedSchedule(dto: FixedScheduleConfirmDto, userId: string) {
    return this.fixedScheduleService.confirm(dto, userId);
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
          id:         c.id,
          name:       c.name,
          type:       c.type,
          price:      Number(c.price),
          available:  slotConflicts.length === 0,
          isOriginal: c.id === courtId, // FIX: đổi isSelected → isOriginal để khớp CheckSlotCourtResult type
        };
      }),
    );

    return {
      date:         formatDate(dateObj),
      timeStart,
      timeEnd,
      courts:       courtsWithAvailability,
      hasAvailable: courtsWithAvailability.some((c) => c.available), // FIX: thêm shortcut
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

    if (booking.fixedScheduleId) {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id },
          data: {
            status: 'confirmed',
            slots: { updateMany: { where: {}, data: { status: 'booked' } } },
          },
        });

        const remainingUnconfirmed = await tx.booking.count({
          where: {
            fixedScheduleId: booking.fixedScheduleId!,
            status: { in: ['pending', 'deposited'] },
          },
        });

        if (remainingUnconfirmed === 0) {
          await tx.fixedSchedule.update({
            where: { id: booking.fixedScheduleId! },
            data: { status: 'confirmed' },
            select: { id: true },
          });

          await tx.invoice.updateMany({
            where: { fixedScheduleId: booking.fixedScheduleId!, status: 'unpaid' },
            data: { status: 'paid' },
          });
        }

        return tx.booking.findUnique({
          where: { id },
          include: { court: { include: { branch: true } }, user: true },
        });
      });

      if (!updated) {
        throw new NotFoundException(`Booking #${id} không tồn tại`);
      }

      return { success: true, booking: updated };
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'confirmed',
        slots: { updateMany: { where: {}, data: { status: 'booked' } } },
      },
      include: { court: { include: { branch: true } }, user: true },
    });

    // Cập nhật invoice liên kết → paid (cho thanh toán tiền mặt tại quầy)
    await this.prisma.invoice.updateMany({
      where: { bookingId: id, status: 'unpaid' },
      data:  { status: 'paid' },
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

  async startPlaying(id: string, user?: { role?: string | null }) {
    const booking = await this.findOne(id);
    if (booking.status !== 'confirmed') {
      throw new BadRequestException(
        `Không thể check-in booking ${booking.status}`,
      );
    }

    this.assertCanCheckinNow(booking, getBusinessNowParts(new Date()), {
      allowElapsedCheckin: this.isStaffUser(user),
    })

    if (
      this.isStaffUser(user) &&
      this.hasBookingElapsed(booking, getBusinessNowParts(new Date()))
    ) {
      return this.markBookingCompleted(id);
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: 'playing' },
      include: { court: { include: { branch: true } }, user: true },
    });
    return { success: true, booking: updated };
  }

  private async markBookingCompleted(id: string) {
    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: 'completed' },
      include: { court: { include: { branch: true } }, user: true },
    });

    if (updated.fixedOccurrenceId) {
      await this.prisma.fixedScheduleOccurrence.updateMany({
        where: { id: updated.fixedOccurrenceId },
        data: { status: 'completed' },
      });
    }

    return { success: true, booking: updated };
  }

  async complete(id: string) {
    const booking = await this.findOne(id);
    if (booking.status !== 'playing') {
      throw new BadRequestException(
        `Không thể hoàn thành booking ${booking.status}`,
      );
    }
    return this.markBookingCompleted(id);
  }

  async cancel(id: string, options: CancelBookingOptions = {}) {
    const booking = await this.findOne(id);
    if (['completed', 'cancelled'].includes(booking.status)) {
      throw new BadRequestException('Không thể hủy booking này');
    }

    const cancellationReason = this.normalizeCancellationReason(options.reason)

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancellationReason,
        cancelledAt: options.cancelledAt ?? new Date(),
        cancelledByName: options.cancelledByName ?? null,
        cancelledByRole: options.cancelledByRole ?? null,
        slots: { deleteMany: {} },
        ...(booking.fixedOccurrenceId
          ? { fixedOccurrence: { update: { status: 'cancelled' } } }
          : {}),
      },
      include: {
        court: { include: { branch: true } },
        branch: true,
        user: { select: { fullName: true, email: true, phone: true } },
      },
    });
    await this.prisma.invoice.updateMany({
      where: { bookingId: id, status: 'unpaid' },
      data: { status: 'cancelled' },
    });
    if (options.notify !== false) {
      try {
        await this.sendBookingCancellationNotifications(updated)
      } catch (error) {
        this.logger.warn(
          `Failed to send cancellation notifications for booking ${id}: ${error instanceof Error ? error.message : 'unknown error'}`,
        )
      }
    }
    return { success: true, booking: updated };
  }

  async updateStatus(id: string, dto: UpdateBookingStatusDto, user?: { role?: string | null }) {
    const booking = await this.findOne(id);
    const validTransitions: Record<string, string[]> = {
      pending: ['deposited', 'confirmed', 'cancelled'],
      deposited: ['confirmed', 'cancelled'],
      confirmed: ['playing', 'cancelled'],
      playing: ['completed'],
      completed: [],
      cancelled: [],
    };
    const staffCompletesElapsedConfirmed =
      this.isStaffUser(user) &&
      booking.status === 'confirmed' &&
      dto.status === 'completed' &&
      this.hasBookingElapsed(booking, getBusinessNowParts(new Date()));

    if (!validTransitions[booking.status]?.includes(dto.status) && !staffCompletesElapsedConfirmed) {
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
        return this.startPlaying(id, user);
      case 'completed':
        if (staffCompletesElapsedConfirmed) return this.markBookingCompleted(id);
        return this.complete(id);
      case 'cancelled':
        return this.cancel(id, {
          cancelledByName: 'Hệ thống',
          cancelledByRole: 'system',
        });
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
        invoices: { select: { id: true, code: true, status: true }, take: 1 },
      },
      orderBy: [{ bookingDate: 'desc' }, { timeStart: 'asc' }],
    });
  }

  async findByUser(userId: string) {
    await this.autoCompleteElapsedPlayingBookings({ userId }).catch(() => {})
    return this.prisma.booking.findMany({
      where: { userId },
      include: {
        court: { select: { name: true, image: true, type: true, price: true } },
        branch: { select: { name: true, address: true } },
        slots: { select: { time: true, status: true } },
        invoices: { select: { id: true, code: true, status: true }, take: 1 },
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
    await this.autoCompleteElapsedPlayingBookings({ bookingIds: [id] }).catch(() => {})
    const booking = await this.findOne(id);
    if (user.role === 'admin' || user.role === 'employee') return booking;
    if (booking.userId && booking.userId === user.id) return booking;
    throw new ForbiddenException('Bạn không có quyền xem booking này');
  }

  async cancelForUser(id: string, user: any, dto?: CancelBookingDto) {
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
    const fallbackReason =
      user.role === 'user'
        ? 'Khách hàng tự hủy booking'
        : user.role === 'admin'
          ? 'Admin hủy booking'
          : 'Nhân viên hủy booking'

    return this.cancel(id, {
      reason: dto?.reason ?? fallbackReason,
      cancelledByName: user.fullName || user.username || this.getCancellerRoleLabel(user.role),
      cancelledByRole: user.role || 'system',
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // RECURRING BOOKING: tạo nhiều booking theo số tuần
  // ═══════════════════════════════════════════════════════════════
  async createRecurring(dto: CreateRecurringDto, user?: { role?: string | null }) {
    const results: any[] = [];
    const errors: any[] = [];
    const startDate = new Date(dto.start_date);

    for (let i = 0; i < dto.weeks; i++) {
      const bookingDate = new Date(startDate);
      bookingDate.setDate(startDate.getDate() + i * 7);
      const dateStr = bookingDate.toISOString().split('T')[0];

      try {
        const booking = await this.create({
          court_id:       dto.court_id,
          booking_date:   dateStr,
          time_start:     dto.time_start,
          time_end:       dto.time_end,
          slots:          dto.slots,
          customer_name:  dto.customer_name,
          customer_phone: dto.customer_phone,
          customer_email: dto.customer_email,
          payment_method: dto.payment_method ?? 'cash',
          user_id:        dto.user_id,
          amount:         dto.amount,
        }, user);
        results.push(booking);
      } catch (e: any) {
        errors.push({ date: dateStr, error: e.message || 'Lỗi tạo booking' });
      }
    }

    return { success: true, created: results.length, errors, data: results };
  }

  // ═══════════════════════════════════════════════════════════════
  // UPDATE SERVICES: cập nhật dịch vụ đi kèm booking
  // (DB không có cột riêng; trả về booking hiện tại kèm data dịch vụ)
  // ═══════════════════════════════════════════════════════════════
  async updateServices(id: string, dto: UpdateServicesDto) {
    const booking = await this.findOne(id);
    // Trả về booking + overlay service data từ DTO
    return {
      ...booking,
      serviceLines:    dto.service_lines ?? null,
      servicePaidHash: dto.paid_hash ?? null,
      servicePaidAt:   dto.paid_at ?? null,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // DELETE BOOKING
  // ═══════════════════════════════════════════════════════════════
  async deleteBooking(id: string) {
    const booking = await this.findOne(id);
    if (booking.status === 'playing') {
      throw new BadRequestException('Không thể xóa booking đang chơi');
    }
    // Hủy trước rồi xóa (để cascade slot)
    if (!['cancelled', 'completed'].includes(booking.status)) {
      await this.cancel(id, { notify: false });
    }
    await this.prisma.booking.delete({ where: { id } });
    return { message: 'Đã xóa booking' };
  }

  async deleteFixedScheduleTrash(scheduleId: string) {
    const seedInvoice = await this.prisma.invoice.findFirst({
      where: {
        OR: [
          { fixedScheduleId: scheduleId },
          { booking: { fixedScheduleId: scheduleId } },
        ],
      },
      select: {
        id: true,
        fixedScheduleId: true,
        bookingId: true,
        status: true,
      },
    });

    const seedSchedule = await this.prisma.fixedSchedule.findUnique({
      where: { id: scheduleId },
      select: { id: true },
    });

    if (!seedSchedule && !seedInvoice) {
      throw new NotFoundException('Khong tim thay goi lich co dinh hoac hoa don lien quan');
    }

    const scheduleIds = new Set<string>([scheduleId]);
    if (seedInvoice?.fixedScheduleId) {
      scheduleIds.add(seedInvoice.fixedScheduleId);
    }

    if (seedInvoice?.bookingId) {
      const linkedBooking = await this.prisma.booking.findUnique({
        where: { id: seedInvoice.bookingId },
        select: { fixedScheduleId: true },
      });
      if (linkedBooking?.fixedScheduleId) {
        scheduleIds.add(linkedBooking.fixedScheduleId);
      }
    }

    const invoiceLinkedBookings = seedInvoice
      ? await this.prisma.booking.findMany({
          where: {
            invoices: { some: { id: seedInvoice.id } },
            fixedScheduleId: { not: null },
          },
          select: { fixedScheduleId: true },
        })
      : [];
    invoiceLinkedBookings.forEach((booking) => {
      if (booking.fixedScheduleId) scheduleIds.add(booking.fixedScheduleId);
    });

    const schedules = await this.prisma.fixedSchedule.findMany({
      where: { id: { in: [...scheduleIds] } },
      select: {
        id: true,
        status: true,
        bookings: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (schedules.length === 0) {
      throw new NotFoundException('Không tìm thấy gói lịch cố định');
    }

    const fixedScheduleIds = schedules.map((schedule) => schedule.id);
    const bookingIds = schedules.flatMap((schedule) =>
      schedule.bookings.map((booking) => booking.id),
    );
    const invoices = await this.prisma.invoice.findMany({
      where: {
        OR: [
          { fixedScheduleId: { in: fixedScheduleIds } },
          ...(bookingIds.length > 0 ? [{ bookingId: { in: bookingIds } }] : []),
          ...(seedInvoice ? [{ id: seedInvoice.id }] : []),
        ],
      },
      select: {
        id: true,
        status: true,
      },
    });

    const protectedInvoice = invoices.find((invoice) =>
      ['paid', 'deposited', 'refunded'].includes(invoice.status),
    );
    if (protectedInvoice) {
      throw new BadRequestException(
        'Không thể xóa gói/hóa đơn đã thanh toán, đặt cọc hoặc hoàn tiền',
      );
    }

    const protectedBooking = schedules
      .flatMap((schedule) => schedule.bookings)
      .find((booking) =>
        ['deposited', 'confirmed', 'playing', 'completed'].includes(booking.status),
      );
    if (protectedBooking) {
      throw new BadRequestException(
        'Không thể xóa gói đã có buổi đặt được xác nhận, đang chơi hoặc hoàn thành',
      );
    }

    const invoiceIds = invoices.map((invoice) => invoice.id);

    await this.prisma.$transaction(async (tx) => {
      if (invoiceIds.length > 0) {
        await tx.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await tx.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }

      if (bookingIds.length > 0) {
        await tx.courtSlot.deleteMany({ where: { bookingId: { in: bookingIds } } });
        await tx.booking.deleteMany({ where: { id: { in: bookingIds } } });
      }

      await tx.fixedScheduleAdjustment.deleteMany({
        where: { fixedScheduleId: { in: fixedScheduleIds } },
      });
      await tx.fixedScheduleOccurrence.deleteMany({
        where: { fixedScheduleId: { in: fixedScheduleIds } },
      });
      await tx.fixedSchedule.deleteMany({ where: { id: { in: fixedScheduleIds } } });
    });

    return { message: 'Đã xóa hóa đơn/gói lịch cố định rác' };
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

  async checkin(bookingId: string, user?: { role?: string | null }) {
    const allowElapsedCheckin = this.isStaffUser(user)
    let realBookingId = bookingId;
    const fixedOccurrenceQrId = this.parseFixedOccurrenceQrValue(bookingId);
    if (fixedOccurrenceQrId) {
      const occurrenceBooking = await this.prisma.booking.findFirst({
        where: { fixedOccurrenceId: fixedOccurrenceQrId },
        select: { id: true },
      });
      if (!occurrenceBooking) {
        throw new NotFoundException('Khong tim thay buoi lich co dinh theo QR nay');
      }
      realBookingId = occurrenceBooking.id;
    } else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
      const invoice = await this.prisma.invoice.findUnique({
        where: { code: bookingId },
        select: { bookingId: true, fixedScheduleId: true },
      });
      if (!invoice) {
        throw new NotFoundException('Không tìm thấy booking theo mã này');
      }

      if (invoice.bookingId) {
        realBookingId = invoice.bookingId;
      } else if (invoice.fixedScheduleId) {
        const today = normalizeDate(getBusinessNowParts(new Date()).dateToken);
        const candidates = await this.prisma.booking.findMany({
          where: {
            fixedScheduleId: invoice.fixedScheduleId,
            bookingDate: today,
            status: { notIn: ['cancelled', 'completed'] },
          },
          select: {
            id: true,
            bookingDate: true,
            timeStart: true,
            timeEnd: true,
            status: true,
          },
          orderBy: { timeStart: 'asc' },
        });

        if (candidates.length === 0) {
          throw new NotFoundException(
            'Không tìm thấy buổi lịch cố định cần check-in trong ngày hôm nay',
          );
        }

        const availableNow =
          candidates.find((candidate) => {
            try {
              this.assertCanCheckinNow(candidate as any, getBusinessNowParts(new Date()), {
                allowElapsedCheckin,
              });
              return true;
            } catch {
              return false;
            }
          }) || candidates[0];

        realBookingId = availableNow.id;
      } else {
        throw new NotFoundException('Không tìm thấy booking theo mã này');
      }
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: realBookingId },
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

    this.assertCanCheckinNow(booking, getBusinessNowParts(new Date()), {
      allowElapsedCheckin,
    })

    const elapsedAdminCheckin =
      allowElapsedCheckin && this.hasBookingElapsed(booking, getBusinessNowParts(new Date()));

    const updated = await this.prisma.booking.update({
      where: { id: realBookingId },
      data: { status: elapsedAdminCheckin ? 'completed' : 'playing', updatedAt: new Date() },
      include: { court: { include: { branch: true } }, user: true },
    });

    if (elapsedAdminCheckin && updated.fixedOccurrenceId) {
      await this.prisma.fixedScheduleOccurrence.updateMany({
        where: { id: updated.fixedOccurrenceId },
        data: { status: 'completed' },
      });
    }

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
      select: {
        id: true,
        status: true,
        cycle: true,
        startDate: true,
        endDate: true,
        timeStart: true,
        timeEnd: true,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
        paymentMethod: true,
        occurrenceCount: true,
        adjustmentLimit: true,
        adjustmentUsed: true,
        pricePerHourSnapshot: true,
        totalAmountSnapshot: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            username: true,
          },
        },
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

  async findAllFixedSchedules(branchId?: number) {
    const schedules = await this.prisma.fixedSchedule.findMany({
      where: branchId ? { court: { branchId } } : undefined,
      select: {
        id: true,
        status: true,
        cycle: true,
        startDate: true,
        endDate: true,
        timeStart: true,
        timeEnd: true,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
        paymentMethod: true,
        occurrenceCount: true,
        adjustmentLimit: true,
        adjustmentUsed: true,
        pricePerHourSnapshot: true,
        totalAmountSnapshot: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            username: true,
          },
        },
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
            booking: {
              select: { id: true, status: true },
            },
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
        adjustments: {
          where: { note: { startsWith: CUSTOMER_ADJUST_REQUEST_PENDING } },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const today = normalizeDate(getBusinessNowParts(new Date()).dateToken);
    const todayToken = formatDate(today);

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
      customerEmail: s.customerEmail,
      userId: s.user?.id || null,
      user: s.user || null,
      occurrenceCount: s.occurrenceCount,
      adjustmentLimit: s.adjustmentLimit,
      adjustmentUsed: s.adjustmentUsed,
      pricePerHourSnapshot: Number(s.pricePerHourSnapshot),
      totalAmountSnapshot: Number(s.totalAmountSnapshot),
      createdAt: s.createdAt,
      court: s.court,
      occurrenceSummary: {
        total: s.occurrences.length,
        scheduled: s.occurrences.filter((o) => o.status === 'scheduled').length,
        completed: s.occurrences.filter((o) => o.status === 'completed').length,
        skipped: s.occurrences.filter((o) => o.status === 'skipped').length,
        cancelled: s.occurrences.filter((o) => o.status === 'cancelled').length,
        upcoming: s.occurrences
          .filter((o) => o.status === 'scheduled' && o.occurrenceDate >= today)
          .slice(0, 3)
          .map((o) => ({
            id: o.id,
            date: formatDate(o.occurrenceDate),
            dayLabel: o.dayLabel,
            timeStart: o.timeStart,
            timeEnd: o.timeEnd,
            status: o.status,
            bookingId: o.booking?.id || null,
            bookingStatus: o.booking?.status || null,
            checkinQrValue: o.booking ? this.buildFixedOccurrenceQrValue(o.id) : null,
            checkedIn: this.isFixedOccurrenceCheckedIn({
              occurrenceStatus: o.status,
              bookingStatus: o.booking?.status,
            }),
            canShowCheckinQr:
              formatDate(o.occurrenceDate) === todayToken &&
              Boolean(o.booking) &&
              o.booking?.status !== 'cancelled',
          })),
      },
      pendingAdjustmentCount: s.adjustments.length,
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
      select: {
        id: true,
        userId: true,
        status: true,
        cycle: true,
        startDate: true,
        endDate: true,
        timeStart: true,
        timeEnd: true,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
        paymentMethod: true,
        occurrenceCount: true,
        adjustmentLimit: true,
        adjustmentUsed: true,
        pricePerHourSnapshot: true,
        totalAmountSnapshot: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            username: true,
          },
        },
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
            occurrenceId: true,
            type: true,
            oldDate: true,
            newDate: true,
            oldTimeStart: true,
            oldTimeEnd: true,
            newTimeStart: true,
            newTimeEnd: true,
            oldCourtId: true,
            newCourtId: true,
            note: true,
            createdAt: true,
          },
        },
        invoices: {
          select: {
            id: true,
            code: true,
            totalSnapshot: true,
            status: true,
            paymentMethod: true,
            items: true,
          },
        },
      },
    });

    if (!schedule) throw new NotFoundException('Không tìm thấy gói đặt lịch');

    // Validate quyền truy cập
    const isOwner = schedule.userId === user.id;
    const isStaff = user.role === 'admin' || user.role === 'employee';
    const detailTodayToken = getBusinessNowParts(new Date()).dateToken;
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
      userId: schedule.userId || null,
      user: schedule.user || null,
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
        checkinQrValue: o.booking ? this.buildFixedOccurrenceQrValue(o.id) : null,
        checkedIn: this.isFixedOccurrenceCheckedIn({
          occurrenceStatus: o.status,
          bookingStatus: o.booking?.status,
        }),
        canShowCheckinQr:
          formatDate(o.occurrenceDate) === detailTodayToken &&
          Boolean(o.booking) &&
          o.booking?.status !== 'cancelled',
        latestAdjustment: (() => {
          const adjustment = schedule.adjustments.find((item) => item.occurrenceId === o.id);
          return adjustment
            ? {
                ...adjustment,
                oldDate: adjustment.oldDate ? formatDate(adjustment.oldDate) : null,
                newDate: adjustment.newDate ? formatDate(adjustment.newDate) : null,
              }
            : null;
        })(),
      })),
      adjustments: schedule.adjustments,
      invoice: schedule.invoices[0] || null,
    };
  }

  async requestFixedOccurrenceAdjustment(
    scheduleId: string,
    occurrenceId: string,
    dto: FixedScheduleAdjustDto,
    user: any,
  ) {
    const schedule = await this.prisma.fixedSchedule.findUnique({
      where: { id: scheduleId },
      select: {
        id: true,
        userId: true,
        adjustmentLimit: true,
        adjustmentUsed: true,
        occurrences: true,
      },
    });
    if (!schedule) throw new NotFoundException('Không tìm thấy gói đặt cố định');
    if (!schedule.userId || schedule.userId !== user.id) {
      throw new ForbiddenException('Bạn không có quyền gửi yêu cầu cho gói này');
    }
    if (schedule.adjustmentUsed >= schedule.adjustmentLimit) {
      throw new BadRequestException('Bạn đã dùng hết lượt điều chỉnh của gói này');
    }

    const occurrence = schedule.occurrences.find((o) => o.id === occurrenceId);
    if (!occurrence) throw new NotFoundException('Không tìm thấy buổi trong gói');
    if (['cancelled', 'completed', 'skipped'].includes(occurrence.status)) {
      throw new BadRequestException('Buổi này không còn có thể điều chỉnh');
    }
    this.assertFixedOccurrenceAdjustNotice(occurrence);

    const existing = await this.prisma.fixedScheduleAdjustment.findFirst({
      where: {
        fixedScheduleId: schedule.id,
        occurrenceId: occurrence.id,
        note: { startsWith: CUSTOMER_ADJUST_REQUEST_PENDING },
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('Buổi này đã có yêu cầu đang chờ nhân viên duyệt');
    }

    const request = await this.prisma.fixedScheduleAdjustment.create({
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
        note: `${CUSTOMER_ADJUST_REQUEST_PENDING} ${dto.reason || ''}`.trim(),
      },
    });

    return {
      success: true,
      message: 'Đã gửi yêu cầu điều chỉnh. Nhân viên sẽ kiểm tra và xác nhận.',
      requestId: request.id,
    };
  }

  async reviewFixedAdjustmentRequest(adjustmentId: string, body: { approve: boolean; reason?: string }, user: any) {
    if (!(user.role === 'admin' || user.role === 'employee')) {
      throw new ForbiddenException('Chỉ nhân viên mới được duyệt yêu cầu');
    }

    const request = await this.prisma.fixedScheduleAdjustment.findUnique({
      where: { id: adjustmentId },
      select: {
        id: true,
        fixedScheduleId: true,
        occurrenceId: true,
        type: true,
        newCourtId: true,
        newDate: true,
        newTimeStart: true,
        newTimeEnd: true,
        note: true,
      },
    });
    if (!request || !request.note?.startsWith(CUSTOMER_ADJUST_REQUEST_PENDING)) {
      throw new NotFoundException('Không tìm thấy yêu cầu đang chờ duyệt');
    }

    if (!body.approve) {
      const rejectReason = body.reason?.trim();
      if (!rejectReason) {
        throw new BadRequestException('Vui lòng nhập lý do từ chối yêu cầu đổi lịch');
      }
      await this.prisma.fixedScheduleAdjustment.update({
        where: { id: adjustmentId },
        data: {
          note: `${CUSTOMER_ADJUST_REQUEST_REJECTED} ${rejectReason}`.trim(),
        },
      });
      return { success: true, message: 'Đã từ chối yêu cầu điều chỉnh' };
    }

    const dto: FixedScheduleAdjustDto = {
      type: request.type as FixedAdjustmentType,
      newCourtId: request.newCourtId || undefined,
      newDate: request.newDate ? formatDate(request.newDate) : undefined,
      newTimeStart: request.newTimeStart || undefined,
      newTimeEnd: request.newTimeEnd || undefined,
      reason: request.note.replace(CUSTOMER_ADJUST_REQUEST_PENDING, '').trim() || undefined,
    };

    await this.adjustFixedOccurrence(request.fixedScheduleId, request.occurrenceId!, dto, user);
    await this.prisma.fixedScheduleAdjustment.update({
      where: { id: adjustmentId },
      data: { note: `${CUSTOMER_ADJUST_REQUEST_APPROVED} ${dto.reason || ''}`.trim() },
    });
    return { success: true, message: 'Đã duyệt và áp dụng yêu cầu điều chỉnh' };
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
  async updateFixedScheduleAdjustmentLimit(
    scheduleId: string,
    dto: UpdateFixedScheduleAdjustmentLimitDto,
    user: any,
  ) {
    if (!(user.role === 'admin' || user.role === 'employee')) {
      throw new ForbiddenException('Chỉ nhân viên mới được cập nhật số lượt đổi lịch');
    }

    const schedule = await this.prisma.fixedSchedule.findUnique({
      where: { id: scheduleId },
      select: {
        id: true,
        adjustmentUsed: true,
        adjustmentLimit: true,
      },
    });

    if (!schedule) throw new NotFoundException('Không tìm thấy gói đặt lịch cố định');
    if (dto.adjustmentLimit < schedule.adjustmentUsed) {
      throw new BadRequestException(
        `Số lượt đổi không được nhỏ hơn số lượt đã dùng (${schedule.adjustmentUsed}).`,
      );
    }

    return this.prisma.fixedSchedule.update({
      where: { id: scheduleId },
      data: { adjustmentLimit: dto.adjustmentLimit },
      select: {
        id: true,
        status: true,
        adjustmentLimit: true,
        adjustmentUsed: true,
      },
    });
  }

  async confirmFixedSchedulePayment(scheduleId: string, paymentMethod?: string) {
    const schedule = await this.prisma.fixedSchedule.findUnique({
      where: { id: scheduleId },
      select: {
        id: true,
        status: true,
        paymentMethod: true,
        invoices: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true },
        },
      },
    });

    if (!schedule) {
      throw new NotFoundException('Không tìm thấy gói đặt lịch cố định');
    }

    const invoice = schedule.invoices[0];
    if (!invoice) {
      throw new NotFoundException('Không tìm thấy hóa đơn của gói lịch cố định');
    }

    if (invoice.status === 'paid') {
      return { success: true, message: 'Gói lịch cố định đã được thanh toán' };
    }

    const method = paymentMethod || schedule.paymentMethod || 'cash';

    await this.prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: 'paid', paymentMethod: method },
      });

      await tx.fixedSchedule.update({
        where: { id: schedule.id },
        data: { status: 'confirmed', paymentMethod: method },
        select: { id: true },
      });

      await tx.booking.updateMany({
        where: { fixedScheduleId: schedule.id },
        data: { status: 'confirmed', paymentMethod: method },
      });

      await tx.courtSlot.updateMany({
        where: { booking: { fixedScheduleId: schedule.id } },
        data: { status: 'booked' },
      });
    });

    return { success: true, message: 'Xác nhận thanh toán lịch cố định thành công' };
  }

  async adjustFixedOccurrence(
    scheduleId: string,
    occurrenceId: string,
    dto: FixedScheduleAdjustDto,
    user: any,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const schedule = await tx.fixedSchedule.findUnique({
        where: { id: scheduleId },
        select: {
          id: true,
          userId: true,
          adjustmentLimit: true,
          adjustmentUsed: true,
          occurrences: true,
        },
      });
      if (!schedule) throw new NotFoundException('Không tìm thấy gói đặt cố định');
      if (!(user.role === 'admin' || user.role === 'employee')) {
        throw new ForbiddenException('Chỉ nhân viên mới được áp dụng điều chỉnh trực tiếp');
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
      if (!(user.role === 'admin' || user.role === 'employee')) {
        this.assertFixedOccurrenceAdjustNotice(occurrence);
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
        select: { id: true, status: true, adjustmentLimit: true, adjustmentUsed: true },
      });
      return { success: true, fixedSchedule: updatedSchedule };
    });
  }
}
