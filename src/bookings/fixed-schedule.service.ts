/**
 * Service xử lý Fixed Schedule (đặt sân cố định).
 *
 * Tách khỏi BookingsService để:
 * - Single Responsibility (mỗi service 1 việc)
 * - Dễ test
 * - bookings.service.ts không phình to khi thêm tính năng
 *
 * Helper functions dùng chung với BookingsService → import từ booking.helpers.ts
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
  OccurrenceAction,
  PaymentMethod,
} from './dto/booking.dto';
import {
  normalizeDate,
  formatDate,
  dayLabel,
  buildHourSlots,
  generateFixedDates,
  validateFixedScheduleInput,
  invoiceCode,
  checkSlotConflict,
  ConflictSlot,
  SuggestedReplacement,
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

  /**
   * Bước 1: Khách điền form → BE trả về danh sách buổi + conflict + suggestion.
   * KHÔNG tạo data. Idempotent.
   */
  async preview(dto: FixedSchedulePreviewDto) {
    validateFixedScheduleInput(dto);

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

    const dates = generateFixedDates(dto.startDate, dto.endDate, dto.cycle);
    if (dates.length === 0) {
      throw new BadRequestException('Không có buổi nào trong khoảng đã chọn');
    }

    const hours = buildHourSlots(dto.timeStart, dto.timeEnd);

    // Check conflict + suggest replacement cho từng buổi
    const occurrences: PreviewOccurrence[] = await Promise.all(
      dates.map((date) =>
        this.buildPreviewOccurrence(date, court, hours, dto.timeStart, dto.timeEnd),
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
    const estimatedTotal = pricePerSession * billableCount;

    return {
      court: {
        id: court.id,
        name: court.name,
        type: court.type,
        price: pricePerHour,
        branchId: court.branchId,
      },
      cycle: dto.cycle,
      startDate: formatDate(normalizeDate(dto.startDate)),
      endDate: formatDate(normalizeDate(dto.endDate)),
      timeStart: dto.timeStart,
      timeEnd: dto.timeEnd,
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
  // PUBLIC: CONFIRM
  // ───────────────────────────────────────────────────────────

  /**
   * Bước 2: User chốt gói với decisions[] cho từng buổi.
   * BE re-validate + tạo records trong 1 transaction.
   */
  async confirm(dto: FixedScheduleConfirmDto) {
    validateFixedScheduleInput(dto);

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

      const hours = buildHourSlots(dto.timeStart, dto.timeEnd);
      const pricePerHour = Number(originalCourt.price);
      const pricePerSession = pricePerHour * hours.length;
      const totalAmount = pricePerSession * billable.length;

      const adjustmentLimit =
        dto.adjustmentLimit ?? (dto.cycle === 'monthly' ? 2 : 1);

      const fixedSchedule = await tx.fixedSchedule.create({
        data: {
          userId: dto.userId || null,
          courtId: dto.courtId,
          cycle: dto.cycle,
          startDate: normalizeDate(dto.startDate),
          endDate: normalizeDate(dto.endDate),
          timeStart: dto.timeStart,
          timeEnd: dto.timeEnd,
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
        if (decision.action === OccurrenceAction.SKIP) {
          await this.handleSkipDecision(tx, fixedSchedule.id, decision, {
            courtId: dto.courtId,
            timeStart: dto.timeStart,
            timeEnd: dto.timeEnd,
            pricePerHour,
          });
          continue;
        }

        const result = await this.handleBillableDecision(tx, {
          decision,
          fixedScheduleId: fixedSchedule.id,
          originalCourt,
          hours,
          pricePerHour,
          pricePerSession,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail,
          userId: dto.userId,
          paymentMethod: dto.paymentMethod,
          timeStart: dto.timeStart,
          timeEnd: dto.timeEnd,
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
  // PRIVATE: HANDLE KEEP/REPLACE DECISION
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

    // CUSTOM action: user tự chọn sân + giờ khác hẳn
    const isCustom = decision.action === OccurrenceAction.CUSTOM;
    const effectiveTimeStart = isCustom && decision.customTimeStart
      ? decision.customTimeStart
      : args.timeStart;
    const effectiveTimeEnd = isCustom && decision.customTimeEnd
      ? decision.customTimeEnd
      : args.timeEnd;

    // Dùng giờ mới để tính lại hours nếu là custom
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

    if (!targetCourt) {
      throw new NotFoundException(
        `Sân ID ${targetCourtId} không tồn tại`,
      );
    }

    if (
      decision.action !== OccurrenceAction.KEEP &&
      targetCourt.branchId !== originalCourt.branchId
    ) {
      throw new BadRequestException(
        'Sân thay thế phải cùng chi nhánh với sân gốc',
      );
    }

    // Re-check conflict với giờ thực tế
    const conflicts = await checkSlotConflict(tx, targetCourtId, occDate, effectiveHours);
    if (conflicts.length > 0) {
      throw new ConflictException(
        `Buổi ${decision.date} sân ID ${targetCourtId} (${effectiveTimeStart}-${effectiveTimeEnd}) đã có người đặt: ${conflicts.map((c) => c.time).join(', ')}`,
      );
    }

    // Giá: custom dùng giờ mới → tính lại theo số giờ thực tế
    // Nhưng vẫn dùng pricePerHour của sân gốc (policy bù miễn phí)
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

    // Log adjustment nếu là replace hoặc custom
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

    const invoiceItem = {
      description: `${targetCourt.name} - ${formatDate(occDate)} ${effectiveTimeStart}-${effectiveTimeEnd}`,
      quantity: effectiveHours.length,
      unitPriceSnapshot: args.pricePerHour,
      lineTotalSnapshot: occurrenceAmount,
    };

    return { booking, invoiceItem };
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

  /**
   * Tìm sân thay thế cùng branch, cùng type, cùng ngày/giờ.
   */
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
      if (conflicts.length === 0) {
        return court;
      }
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