/**
 * Service xử lý Fixed Schedule (đặt sân cố định).
 * CHANGES:
 * - Thêm checkSlot(): trả về danh sách sân cùng chi nhánh + availability
 *   theo khung giờ mới user muốn đổi. FE dùng trong modal "Đổi giờ / Chọn sân".
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CourtType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  FixedSchedulePreviewDto,
  FixedScheduleConfirmDto,
  CheckSlotDto,
  OccurrenceAction,
  PaymentMethod,
} from './dto/booking.dto';
import {
  normalizeDate,
  formatDate,
  dayLabel,
  buildHourSlots,
  resolveFixedSchedulePlan,
  invoiceCode,
  checkSlotConflict,
  PreviewOccurrence,
} from './booking.helpers';

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

@Injectable()
export class FixedScheduleService {
  constructor(private prisma: PrismaService) {}

  // ───────────────────────────────────────────────────────────
  // PUBLIC: PREVIEW
  // ───────────────────────────────────────────────────────────

  async preview(dto: FixedSchedulePreviewDto) {
    const plan = resolveFixedSchedulePlan(dto);

    const court = await this.prisma.court.findUnique({
      where: { id: dto.courtId },
      select: {
        id: true,
        name: true,
        type: true,
        price: true,
        available: true,
        branchId: true,
      },
    });
    if (!court) throw new NotFoundException('Sân không tồn tại');
    if (!court.available) {
      throw new BadRequestException('Sân hiện đang đóng cửa');
    }

    const dates = plan.occurrences.map((occurrence) => occurrence.date);
    if (dates.length === 0) {
      throw new BadRequestException('Không có buổi nào trong khoảng đã chọn');
    }

    const hours = plan.occurrences[0].hours;

    const occurrences: PreviewOccurrence[] = await Promise.all(
      plan.occurrences.map((occurrence) =>
        this.buildPreviewOccurrence(
          occurrence.date,
          court,
          occurrence.hours,
          occurrence.timeStart,
          occurrence.timeEnd,
        ),
      ),
    );

    const availableCount = occurrences.filter((o) => !o.hasConflict).length;
    const replaceableCount = occurrences.filter(
      (o) => o.hasConflict && o.suggestedReplacement !== null,
    ).length;
    const unresolvableCount = occurrences.filter(
      (o) => o.hasConflict && o.suggestedReplacement === null,
    ).length;

    const pricePerHour = Number(court.price);
    const pricePerSession = pricePerHour * hours.length;
    const billableCount = availableCount + replaceableCount;
    const estimatedTotal = occurrences.reduce((total, occurrence) => {
      if (occurrence.hasConflict && occurrence.suggestedReplacement === null) {
        return total;
      }
      const sourceOccurrence = plan.occurrences.find(
        (item) => item.dateKey === occurrence.date,
      );
      return total + pricePerHour * (sourceOccurrence?.hours.length ?? 0);
    }, 0);

    return {
      court: {
        id: court.id,
        name: court.name,
        type: court.type,
        price: pricePerHour,
        branchId: court.branchId,
      },
      cycle: dto.cycle,
      bookingMode: plan.bookingMode,
      occurrenceCount: plan.requestedOccurrenceCount,
      rules: plan.rules,
      startDate: formatDate(plan.startDate),
      endDate: formatDate(plan.endDate),
      timeStart: plan.primaryTimeStart,
      timeEnd: plan.primaryTimeEnd,
      hoursPerSession: hours.length,
      occurrences,
      summary: {
        totalOccurrences: occurrences.length,
        availableCount,
        replaceableCount,
        unresolvableCount,
      },
      pricing: {
        pricePerHour,
        pricePerSession,
        estimatedTotal,
        currency: 'VND',
      },
    };
  }

  // ───────────────────────────────────────────────────────────
  // PUBLIC: CHECK SLOT  ← NEW
  // ───────────────────────────────────────────────────────────

  /**
   * Kiểm tra availability của TẤT CẢ sân cùng chi nhánh + cùng type
   * theo ngày + khung giờ mới mà user muốn đổi.
   *
   * FE gọi khi:
   * 1. User bấm "Đổi giờ" trên 1 occurrence → chọn giờ mới → bấm "Kiểm tra"
   * 2. Response trả về danh sách sân với available: true/false
   * 3. User chọn 1 sân → FE gán action='custom' + replaceWithCourtId + customTimeStart/End
   *
   * Yêu cầu:
   * - courtId: sân GỐC của gói (để lấy branchId + type)
   * - date: ngày của buổi cần đổi (YYYY-MM-DD)
   * - timeStart / timeEnd: khung giờ MỚI user muốn
   */
  async checkSlot(dto: CheckSlotDto) {
    // Validate giờ hợp lệ
    const hours = buildHourSlots(dto.timeStart, dto.timeEnd);

    // Lấy thông tin sân gốc để biết branchId + type
    const originalCourt = await this.prisma.court.findUnique({
      where: { id: dto.courtId },
      select: { id: true, name: true, type: true, branchId: true, price: true },
    });
    if (!originalCourt) throw new NotFoundException('Sân không tồn tại');

    const date = normalizeDate(dto.date);

    // Lấy TẤT CẢ sân cùng chi nhánh, cùng type (bao gồm cả sân gốc)
    const allCourts = await this.prisma.court.findMany({
      where: {
        branchId: originalCourt.branchId,
        type: originalCourt.type,
        available: true,
      },
      select: { id: true, name: true, type: true, price: true },
      orderBy: { id: 'asc' },
    });

    // Check conflict cho từng sân
    const courtsWithAvailability = await Promise.all(
      allCourts.map(async (court) => {
        const conflicts = await checkSlotConflict(
          this.prisma,
          court.id,
          date,
          hours,
        );
        return {
          id: court.id,
          name: court.name,
          type: court.type,
          price: Number(court.price),
          available: conflicts.length === 0,
          // isOriginal giúp FE highlight sân gốc
          isOriginal: court.id === dto.courtId,
        };
      }),
    );

    return {
      date: formatDate(date),
      timeStart: dto.timeStart,
      timeEnd: dto.timeEnd,
      courts: courtsWithAvailability,
      // Summary nhanh để FE biết có available không
      hasAvailable: courtsWithAvailability.some((c) => c.available),
    };
  }

  // ───────────────────────────────────────────────────────────
  // PUBLIC: CONFIRM
  // ───────────────────────────────────────────────────────────

  async confirm(dto: FixedScheduleConfirmDto) {
    const plan = resolveFixedSchedulePlan(dto);

    const billable = dto.decisions.filter(
      (d) =>
        d.action === OccurrenceAction.KEEP ||
        d.action === OccurrenceAction.REPLACE ||
        d.action === OccurrenceAction.CUSTOM,
    );
    if (billable.length === 0) {
      throw new BadRequestException(
        'Phải có ít nhất 1 buổi được giữ hoặc thay thế',
      );
    }

    for (const d of dto.decisions) {
      if (d.action === OccurrenceAction.REPLACE && !d.replaceWithCourtId) {
        throw new BadRequestException(
          `Buổi ${d.date}: action "replace" cần có replaceWithCourtId`,
        );
      }
      if (d.action === OccurrenceAction.CUSTOM) {
        if (!d.replaceWithCourtId) {
          throw new BadRequestException(
            `Buổi ${d.date}: action "custom" cần có replaceWithCourtId`,
          );
        }
        if (!d.customTimeStart || !d.customTimeEnd) {
          throw new BadRequestException(
            `Buổi ${d.date}: action "custom" cần có customTimeStart và customTimeEnd`,
          );
        }
      }
    }

    const occurrenceByDate = new Map(
      plan.occurrences.map((occurrence) => [occurrence.dateKey, occurrence]),
    );
    const decisionDates = new Set<string>();

    for (const decision of dto.decisions) {
      const dateKey = formatDate(normalizeDate(decision.date));
      if (decisionDates.has(dateKey)) {
        throw new BadRequestException(
          `Buổi ${decision.date} bị gửi quyết định trùng.`,
        );
      }
      if (!occurrenceByDate.has(dateKey)) {
        throw new BadRequestException(
          `Buổi ${decision.date} không thuộc lịch cố định đã chọn.`,
        );
      }
      decisionDates.add(dateKey);
    }

    const missingOccurrence = plan.occurrences.find(
      (occurrence) => !decisionDates.has(occurrence.dateKey),
    );
    if (missingOccurrence) {
      throw new BadRequestException(
        `Thiếu quyết định cho buổi ${missingOccurrence.dateKey}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const originalCourt = await tx.court.findUnique({
        where: { id: dto.courtId },
        select: {
          id: true,
          name: true,
          type: true,
          price: true,
          branchId: true,
          available: true,
        },
      });
      if (!originalCourt) throw new NotFoundException('Sân không tồn tại');
      if (!originalCourt.available) {
        throw new BadRequestException('Sân hiện đang đóng cửa');
      }

      const pricePerHour = Number(originalCourt.price);
      const totalAmount = billable.reduce((total, decision) => {
        const occurrence = occurrenceByDate.get(
          formatDate(normalizeDate(decision.date)),
        )!;
        const hours =
          decision.action === OccurrenceAction.CUSTOM &&
          decision.customTimeStart &&
          decision.customTimeEnd
            ? buildHourSlots(decision.customTimeStart, decision.customTimeEnd)
            : occurrence.hours;
        return total + pricePerHour * hours.length;
      }, 0);

      const adjustmentLimit = dto.cycle === 'monthly' ? 2 : 1;

      const fixedSchedule = await tx.fixedSchedule.create({
        data: {
          userId: dto.userId || null,
          courtId: dto.courtId,
          cycle: dto.cycle,
          bookingMode: plan.bookingMode,
          requestedOccurrenceCount: plan.requestedOccurrenceCount ?? null,
          rules: plan.rules as any,
          startDate: plan.startDate,
          endDate: plan.endDate,
          timeStart: plan.primaryTimeStart,
          timeEnd: plan.primaryTimeEnd,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail || null,
          paymentMethod: dto.paymentMethod,
          pricePerHourSnapshot: pricePerHour,
          totalAmountSnapshot: totalAmount,
          occurrenceCount: billable.length,
          adjustmentLimit,
          adjustmentUsed: 0,
          status: this.deriveInitialScheduleStatus(dto.paymentMethod),
        },
      });

      const createdBookings: any[] = [];
      const invoiceItems: any[] = [];

      for (const decision of dto.decisions) {
        const plannedOccurrence = occurrenceByDate.get(
          formatDate(normalizeDate(decision.date)),
        )!;
        if (decision.action === OccurrenceAction.SKIP) {
          await this.handleSkipDecision(tx, fixedSchedule.id, decision, {
            courtId: dto.courtId,
            timeStart: plannedOccurrence.timeStart,
            timeEnd: plannedOccurrence.timeEnd,
            pricePerHour,
          });
          continue;
        }

        const pricePerSession = pricePerHour * plannedOccurrence.hours.length;
        const result = await this.handleBillableDecision(tx, {
          decision,
          fixedScheduleId: fixedSchedule.id,
          originalCourt,
          hours: plannedOccurrence.hours,
          pricePerHour,
          pricePerSession,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail,
          userId: dto.userId,
          paymentMethod: dto.paymentMethod,
          timeStart: plannedOccurrence.timeStart,
          timeEnd: plannedOccurrence.timeEnd,
        });
        createdBookings.push(result.booking);
        invoiceItems.push(result.invoiceItem);
      }

      const invoice = await tx.invoice.create({
        data: {
          code: invoiceCode('FS'),
          fixedScheduleId: fixedSchedule.id,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail || null,
          subtotalSnapshot: totalAmount,
          totalSnapshot: totalAmount,
          paymentMethod: dto.paymentMethod,
          status:
            dto.paymentMethod === PaymentMethod.CASH ? 'unpaid' : 'deposited',
          items: { create: invoiceItems },
        },
      });

      return {
        scheduleId: fixedSchedule.id,
        invoiceId: invoice.id,
        invoiceCode: invoice.code,
        totalAmount,
        bookingsCreated: createdBookings.length,
        skipped: dto.decisions.length - billable.length,
        status: fixedSchedule.status,
      };
    });
  }

  // ───────────────────────────────────────────────────────────
  // PRIVATE: HANDLE SKIP DECISION
  // ───────────────────────────────────────────────────────────

  private async handleSkipDecision(
    tx: Prisma.TransactionClient,
    fixedScheduleId: string,
    decision: { date: string; reason?: string },
    ctx: {
      courtId: number;
      timeStart: string;
      timeEnd: string;
      pricePerHour: number;
    },
  ) {
    const occDate = normalizeDate(decision.date);
    await tx.fixedScheduleOccurrence.create({
      data: {
        fixedScheduleId,
        courtId: ctx.courtId,
        occurrenceDate: occDate,
        dayLabel: dayLabel(occDate),
        timeStart: ctx.timeStart,
        timeEnd: ctx.timeEnd,
        pricePerHourSnapshot: ctx.pricePerHour,
        amountSnapshot: 0,
        status: 'skipped',
      },
    });

    await tx.fixedScheduleAdjustment.create({
      data: {
        fixedScheduleId,
        type: 'skip',
        oldCourtId: ctx.courtId,
        oldDate: occDate,
        oldTimeStart: ctx.timeStart,
        oldTimeEnd: ctx.timeEnd,
        note: decision.reason || 'Bỏ qua khi confirm gói',
      },
    });
  }

  // ───────────────────────────────────────────────────────────
  // PRIVATE: HANDLE KEEP/REPLACE/CUSTOM DECISION
  // ───────────────────────────────────────────────────────────

  private async handleBillableDecision(
    tx: Prisma.TransactionClient,
    args: {
      decision: {
        date: string;
        action: OccurrenceAction;
        replaceWithCourtId?: number;
        customTimeStart?: string;
        customTimeEnd?: string;
      };
      fixedScheduleId: string;
      originalCourt: {
        id: number;
        name: string;
        type: CourtType;
        price: Prisma.Decimal;
        branchId: number;
      };
      hours: string[];
      pricePerHour: number;
      pricePerSession: number;
      customerName: string;
      customerPhone: string;
      customerEmail?: string;
      userId?: string;
      paymentMethod: PaymentMethod;
      timeStart: string;
      timeEnd: string;
    },
  ) {
    const { decision, fixedScheduleId, originalCourt } = args;
    const occDate = normalizeDate(decision.date);

    const isCustom = decision.action === OccurrenceAction.CUSTOM;
    const effectiveTimeStart =
      isCustom && decision.customTimeStart
        ? decision.customTimeStart
        : args.timeStart;
    const effectiveTimeEnd =
      isCustom && decision.customTimeEnd
        ? decision.customTimeEnd
        : args.timeEnd;
    const effectiveHours = isCustom
      ? buildHourSlots(effectiveTimeStart, effectiveTimeEnd)
      : args.hours;

    const targetCourtId =
      decision.action === OccurrenceAction.KEEP
        ? originalCourt.id
        : decision.replaceWithCourtId!;

    const targetCourt =
      targetCourtId === originalCourt.id
        ? originalCourt
        : await tx.court.findUnique({
            where: { id: targetCourtId },
            select: {
              id: true,
              name: true,
              type: true,
              price: true,
              branchId: true,
              available: true,
            },
          });

    if (!targetCourt)
      throw new NotFoundException(`Sân ID ${targetCourtId} không tồn tại`);

    if (
      decision.action !== OccurrenceAction.KEEP &&
      targetCourt.branchId !== originalCourt.branchId
    ) {
      throw new BadRequestException(
        'Sân thay thế phải cùng chi nhánh với sân gốc',
      );
    }

    if ('available' in targetCourt && targetCourt.available === false) {
      throw new BadRequestException('Sân thay thế hiện đang đóng cửa');
    }

    if (
      decision.action !== OccurrenceAction.KEEP &&
      targetCourt.type !== originalCourt.type
    ) {
      throw new BadRequestException('Sân thay thế phải cùng loại với sân gốc');
    }

    const conflicts = await checkSlotConflict(
      tx,
      targetCourtId,
      occDate,
      effectiveHours,
    );
    if (conflicts.length > 0) {
      throw new ConflictException(
        `Buổi ${decision.date} sân ID ${targetCourtId} (${effectiveTimeStart}-${effectiveTimeEnd}) đã có người đặt: ${conflicts.map((c) => c.time).join(', ')}`,
      );
    }

    const occurrenceAmount = args.pricePerHour * effectiveHours.length;

    const occurrence = await tx.fixedScheduleOccurrence.create({
      data: {
        fixedScheduleId,
        courtId: targetCourtId,
        occurrenceDate: occDate,
        dayLabel: dayLabel(occDate),
        timeStart: effectiveTimeStart,
        timeEnd: effectiveTimeEnd,
        pricePerHourSnapshot: args.pricePerHour,
        amountSnapshot: occurrenceAmount,
        status: 'scheduled',
      },
    });

    const booking = await tx.booking.create({
      data: {
        courtId: targetCourtId,
        branchId: targetCourt.branchId,
        userId: args.userId || null,
        bookingDate: occDate,
        dayLabel: dayLabel(occDate),
        timeStart: effectiveTimeStart,
        timeEnd: effectiveTimeEnd,
        people: 2,
        amount: occurrenceAmount,
        pricePerHour: args.pricePerHour,
        paymentMethod: args.paymentMethod,
        customerName: args.customerName,
        customerPhone: args.customerPhone,
        customerEmail: args.customerEmail || null,
        status: this.deriveInitialBookingStatus(args.paymentMethod),
        fixedScheduleId,
        fixedOccurrenceId: occurrence.id,
      },
    });

    await tx.courtSlot.createMany({
      data: effectiveHours.map((time) => ({
        courtId: targetCourtId,
        slotDate: occDate,
        dateLabel: dayLabel(occDate),
        time,
        status: args.paymentMethod === PaymentMethod.CASH ? 'hold' : 'booked',
        bookedBy: args.customerName,
        phone: args.customerPhone,
        bookingId: booking.id,
      })),
    });

    if (decision.action !== OccurrenceAction.KEEP) {
      await tx.fixedScheduleAdjustment.create({
        data: {
          fixedScheduleId,
          occurrenceId: occurrence.id,
          type: isCustom ? 'reschedule' : 'change_court',
          oldCourtId: originalCourt.id,
          newCourtId: targetCourtId,
          oldDate: occDate,
          newDate: occDate,
          oldTimeStart: args.timeStart,
          newTimeStart: effectiveTimeStart,
          oldTimeEnd: args.timeEnd,
          newTimeEnd: effectiveTimeEnd,
          note: isCustom
            ? `Đổi giờ + sân khi confirm gói: ${effectiveTimeStart}-${effectiveTimeEnd}`
            : 'Tự động bù sân khi confirm gói',
        },
      });
    }

    return {
      booking,
      invoiceItem: {
        description: `${targetCourt.name} - ${formatDate(occDate)} ${effectiveTimeStart}-${effectiveTimeEnd}`,
        quantity: effectiveHours.length,
        unitPriceSnapshot: args.pricePerHour,
        lineTotalSnapshot: occurrenceAmount,
      },
    };
  }

  // ───────────────────────────────────────────────────────────
  // PRIVATE: BUILD PREVIEW OCCURRENCE
  // ───────────────────────────────────────────────────────────

  private async buildPreviewOccurrence(
    date: Date,
    originalCourt: {
      id: number;
      name: string;
      type: CourtType;
      branchId: number;
    },
    hours: string[],
    timeStart: string,
    timeEnd: string,
  ): Promise<PreviewOccurrence> {
    const conflicts = await checkSlotConflict(
      this.prisma,
      originalCourt.id,
      date,
      hours,
    );

    if (conflicts.length === 0) {
      return {
        courtId: originalCourt.id,
        date: formatDate(date),
        dayLabel: dayLabel(date),
        timeStart,
        timeEnd,
        hasConflict: false,
        conflicts: [],
        suggestedReplacement: null,
      };
    }

    const replacement = await this.findAlternativeCourt(
      originalCourt.branchId,
      originalCourt.id,
      originalCourt.type,
      date,
      hours,
    );

    return {
      courtId: originalCourt.id,
      date: formatDate(date),
      dayLabel: dayLabel(date),
      timeStart,
      timeEnd,
      hasConflict: true,
      conflicts,
      suggestedReplacement: replacement
        ? {
            courtId: replacement.id,
            courtName: replacement.name,
            courtType: replacement.type,
            timeStart,
            timeEnd,
          }
        : null,
    };
  }

  // ───────────────────────────────────────────────────────────
  // PRIVATE: FIND ALTERNATIVE COURT
  // ───────────────────────────────────────────────────────────

  private async findAlternativeCourt(
    branchId: number,
    excludeCourtId: number,
    courtType: CourtType,
    date: Date,
    hours: string[],
  ) {
    const candidates = await this.prisma.court.findMany({
      where: {
        branchId,
        available: true,
        type: courtType,
        id: { not: excludeCourtId },
      },
      select: { id: true, name: true, type: true, price: true },
      orderBy: { id: 'asc' },
    });

    for (const court of candidates) {
      const conflicts = await checkSlotConflict(
        this.prisma,
        court.id,
        date,
        hours,
      );
      if (conflicts.length === 0) return court;
    }
    return null;
  }

  // ───────────────────────────────────────────────────────────
  // PRIVATE: STATUS HELPERS
  // ───────────────────────────────────────────────────────────

  private deriveInitialScheduleStatus(payment: PaymentMethod) {
    return payment === PaymentMethod.CASH ? 'pending' : 'deposited';
  }

  private deriveInitialBookingStatus(payment: PaymentMethod) {
    return payment === PaymentMethod.CASH ? 'pending' : 'confirmed';
  }
}
