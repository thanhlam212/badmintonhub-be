/**
 * Shared utilities cho module bookings.
 *
 * CHANGES:
 * - validateFixedScheduleInput: đổi từ check daysDiff → check số occurrences thực tế
 * - getTodayVN(): helper tính "hôm nay" theo múi giờ VN (UTC+7) tránh reject ngày hôm nay
 */

import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FixedScheduleCycle } from './dto/booking.dto';

// ═══════════════════════════════════════════════════════════════
// TYPE EXPORTS
// ═══════════════════════════════════════════════════════════════

export type DbClient = Prisma.TransactionClient | PrismaService;

export interface ConflictSlot {
  time: string;
  status: string;
  bookedBy: string | null;
}

export interface SuggestedReplacement {
  courtId: number;
  courtName: string;
  courtType: string;
  timeStart: string;
  timeEnd: string;
}

export interface PreviewOccurrence {
  courtId: number;
  date: string;
  dayLabel: string;
  timeStart: string;
  timeEnd: string;
  hasConflict: boolean;
  conflicts: ConflictSlot[];
  suggestedReplacement: SuggestedReplacement | null;
}

export type FixedScheduleBookingModeValue = 'occurrence_count' | 'date_range';

export interface FixedScheduleRuleInput {
  dayOfWeek?: number;
  dayOfMonth?: number;
  timeStart: string;
  timeEnd: string;
}

export interface GeneratedFixedOccurrence {
  date: Date;
  dateKey: string;
  dayLabel: string;
  timeStart: string;
  timeEnd: string;
  hours: string[];
  ruleIndex: number;
}

export interface FixedSchedulePlan {
  bookingMode: FixedScheduleBookingModeValue;
  requestedOccurrenceCount?: number;
  startDate: Date;
  endDate: Date;
  rules: FixedScheduleRuleInput[];
  occurrences: GeneratedFixedOccurrence[];
  primaryTimeStart: string;
  primaryTimeEnd: string;
}

// ═══════════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Chuẩn hóa date về 00:00:00 UTC.
 */
export function normalizeDate(value: string | Date): Date {
  const d = typeof value === 'string' ? new Date(value) : new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * FIX: Tính "hôm nay" theo giờ Việt Nam (UTC+7).
 * Tránh trường hợp server UTC reject ngày hôm nay khi user đặt buổi sáng.
 *
 * Ví dụ: 7:00 sáng VN = 0:00 UTC (cùng ngày) → không bị lệch.
 * Ví dụ: 23:00 đêm VN = 16:00 UTC (cùng ngày) → vẫn đúng.
 */
export function getTodayVN(): Date {
  const now = new Date();
  // Cộng offset UTC+7 rồi lấy ngày UTC → tương đương ngày VN hiện tại
  const vnOffsetMs = 7 * 60 * 60 * 1000;
  const vnNow = new Date(now.getTime() + vnOffsetMs);
  // Đặt về 00:00:00 UTC (= 07:00 VN) để so sánh
  vnNow.setUTCHours(0, 0, 0, 0);
  return vnNow;
}

/**
 * Format Date → "YYYY-MM-DD"
 */
export function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Label tiếng Việt cho ngày trong tuần.
 */
export function dayLabel(date: Date): string {
  const labels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  return labels[date.getUTCDay()];
}

/**
 * Cộng N ngày vào date (immutable).
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

// ═══════════════════════════════════════════════════════════════
// TIME SLOT HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Sinh danh sách slot 1 tiếng từ timeStart đến timeEnd.
 * Ví dụ: ("19:00", "21:00") → ["19:00", "20:00"]
 */
export function buildHourSlots(timeStart: string, timeEnd: string): string[] {
  const [sh] = timeStart.split(':').map(Number);
  const [eh] = timeEnd.split(':').map(Number);

  if (eh <= sh) {
    throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu');
  }

  const slots: string[] = [];
  for (let h = sh; h < eh; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
  }
  return slots;
}

// ═══════════════════════════════════════════════════════════════
// OCCURRENCE GENERATION
// ═══════════════════════════════════════════════════════════════

/**
 * Sinh danh sách ngày theo cycle:
 * - weekly: lặp mỗi 7 ngày
 * - monthly: lặp theo ngày trong tháng, clamp nếu tháng sau không có ngày đó
 */
export function generateFixedDates(
  startDate: string,
  endDate: string,
  cycle: FixedScheduleCycle,
): Date[] {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  const dates: Date[] = [];
  let cursor = new Date(start);

  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor =
      cycle === FixedScheduleCycle.WEEKLY
        ? addDays(cursor, 7)
        : addMonthsClamped(cursor, 1);
  }
  return dates;
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function normalizeFixedScheduleRules(input: {
  startDate: string;
  cycle: FixedScheduleCycle;
  rules?: FixedScheduleRuleInput[];
  timeStart?: string;
  timeEnd?: string;
}): FixedScheduleRuleInput[] {
  const start = normalizeDate(input.startDate);
  const rawRules =
    input.rules && input.rules.length > 0
      ? input.rules
      : [
          {
            dayOfWeek: start.getUTCDay(),
            dayOfMonth: start.getUTCDate(),
            timeStart: input.timeStart,
            timeEnd: input.timeEnd,
          },
        ];

  const seen = new Set<string>();

  return rawRules.map((rule, index) => {
    if (!rule.timeStart || !rule.timeEnd) {
      throw new BadRequestException(
        `Rule #${index + 1} thiếu giờ bắt đầu hoặc giờ kết thúc.`,
      );
    }

    buildHourSlots(rule.timeStart, rule.timeEnd);

    const normalizedRule: FixedScheduleRuleInput = {
      timeStart: rule.timeStart,
      timeEnd: rule.timeEnd,
    };

    if (input.cycle === FixedScheduleCycle.WEEKLY) {
      const dayOfWeek =
        rule.dayOfWeek !== undefined
          ? Number(rule.dayOfWeek)
          : start.getUTCDay();
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        throw new BadRequestException(
          `Rule #${index + 1} có ngày trong tuần không hợp lệ.`,
        );
      }
      normalizedRule.dayOfWeek = dayOfWeek;
    } else {
      const dayOfMonth =
        rule.dayOfMonth !== undefined
          ? Number(rule.dayOfMonth)
          : start.getUTCDate();
      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        throw new BadRequestException(
          `Rule #${index + 1} có ngày trong tháng không hợp lệ.`,
        );
      }
      normalizedRule.dayOfMonth = dayOfMonth;
    }

    const identity =
      input.cycle === FixedScheduleCycle.WEEKLY
        ? `w:${normalizedRule.dayOfWeek}:${normalizedRule.timeStart}:${normalizedRule.timeEnd}`
        : `m:${normalizedRule.dayOfMonth}:${normalizedRule.timeStart}:${normalizedRule.timeEnd}`;

    if (seen.has(identity)) {
      throw new BadRequestException(
        `Rule #${index + 1} bị trùng ngày và khung giờ.`,
      );
    }
    seen.add(identity);

    return normalizedRule;
  });
}

function generateWeeklyOccurrences(
  start: Date,
  end: Date,
  rules: FixedScheduleRuleInput[],
): GeneratedFixedOccurrence[] {
  const occurrences: GeneratedFixedOccurrence[] = [];

  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor = addDays(cursor, 1)
  ) {
    rules.forEach((rule, ruleIndex) => {
      if (cursor.getUTCDay() !== rule.dayOfWeek) return;
      const date = new Date(cursor);
      occurrences.push({
        date,
        dateKey: formatDate(date),
        dayLabel: dayLabel(date),
        timeStart: rule.timeStart,
        timeEnd: rule.timeEnd,
        hours: buildHourSlots(rule.timeStart, rule.timeEnd),
        ruleIndex,
      });
    });
  }

  return occurrences;
}

function generateMonthlyOccurrences(
  start: Date,
  end: Date,
  rules: FixedScheduleRuleInput[],
): GeneratedFixedOccurrence[] {
  const occurrences: GeneratedFixedOccurrence[] = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );

  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const lastDay = lastDayOfMonth(year, month);

    rules.forEach((rule, ruleIndex) => {
      const day = Math.min(rule.dayOfMonth ?? start.getUTCDate(), lastDay);
      const date = new Date(Date.UTC(year, month, day));
      if (date < start || date > end) return;
      occurrences.push({
        date,
        dateKey: formatDate(date),
        dayLabel: dayLabel(date),
        timeStart: rule.timeStart,
        timeEnd: rule.timeEnd,
        hours: buildHourSlots(rule.timeStart, rule.timeEnd),
        ruleIndex,
      });
    });

    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return occurrences;
}

export function resolveFixedSchedulePlan(input: {
  startDate: string;
  endDate?: string;
  cycle: FixedScheduleCycle;
  bookingMode?: FixedScheduleBookingModeValue;
  occurrenceCount?: number;
  rules?: FixedScheduleRuleInput[];
  timeStart?: string;
  timeEnd?: string;
}): FixedSchedulePlan {
  const start = normalizeDate(input.startDate);
  const today = getTodayVN();

  if (start < today) {
    throw new BadRequestException('Ngày bắt đầu phải từ hôm nay trở đi');
  }

  const rules = normalizeFixedScheduleRules(input);
  const bookingMode: FixedScheduleBookingModeValue =
    input.bookingMode ??
    (input.occurrenceCount ? 'occurrence_count' : 'date_range');

  let end: Date;
  let requestedOccurrenceCount: number | undefined;

  if (bookingMode === 'occurrence_count') {
    requestedOccurrenceCount = Number(input.occurrenceCount);
    if (
      !Number.isInteger(requestedOccurrenceCount) ||
      requestedOccurrenceCount < 2 ||
      requestedOccurrenceCount > 52
    ) {
      throw new BadRequestException('Số buổi phải nằm trong khoảng 2 - 52.');
    }

    end =
      input.cycle === FixedScheduleCycle.WEEKLY
        ? addDays(start, 7 * 104)
        : addMonthsClamped(start, 60);
  } else {
    if (!input.endDate) {
      throw new BadRequestException('Vui lòng chọn ngày kết thúc.');
    }
    end = normalizeDate(input.endDate);
    if (end <= start) {
      throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
    }
  }

  let occurrences =
    input.cycle === FixedScheduleCycle.WEEKLY
      ? generateWeeklyOccurrences(start, end, rules)
      : generateMonthlyOccurrences(start, end, rules);

  occurrences.sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      a.timeStart.localeCompare(b.timeStart),
  );

  const seenOccurrences = new Set<string>();
  occurrences = occurrences.filter((occurrence) => {
    const key = `${occurrence.dateKey}:${occurrence.timeStart}:${occurrence.timeEnd}`;
    if (seenOccurrences.has(key)) return false;
    seenOccurrences.add(key);
    return true;
  });

  if (bookingMode === 'occurrence_count') {
    if (occurrences.length < requestedOccurrenceCount!) {
      throw new BadRequestException(
        `Không thể sinh đủ ${requestedOccurrenceCount} buổi từ cấu hình đã chọn.`,
      );
    }
    occurrences = occurrences.slice(0, requestedOccurrenceCount);
    end = occurrences[occurrences.length - 1].date;
  }

  const minimum = input.cycle === FixedScheduleCycle.WEEKLY ? 4 : 2;
  if (occurrences.length < minimum) {
    throw new BadRequestException(
      `Gói ${
        input.cycle === FixedScheduleCycle.WEEKLY ? 'theo tuần' : 'theo tháng'
      } tối thiểu ${minimum} buổi. Hiện tại chỉ có ${occurrences.length} buổi.`,
    );
  }

  const duplicateDate = occurrences.find(
    (occurrence, index) =>
      occurrences.findIndex((item) => item.dateKey === occurrence.dateKey) !==
      index,
  );
  if (duplicateDate) {
    throw new BadRequestException(
      'Hiện tại mỗi ngày chỉ hỗ trợ một buổi trong gói cố định. Vui lòng tách các buổi cùng ngày thành gói riêng.',
    );
  }

  return {
    bookingMode,
    requestedOccurrenceCount,
    startDate: start,
    endDate: end,
    rules,
    occurrences,
    primaryTimeStart: rules[0].timeStart,
    primaryTimeEnd: rules[0].timeEnd,
  };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Validate input cho cả Preview và Confirm fixed schedule.
 *
 * FIX so với cũ:
 * 1. Dùng getTodayVN() thay vì normalizeDate(new Date()) để tránh lệch timezone.
 * 2. Validate số occurrences THỰC TẾ (gọi generateFixedDates) thay vì
 *    check daysDiff thô — vì user có thể chọn startDate=2025-06-19,
 *    endDate=2025-07-10 (21 ngày) mà vẫn đủ 4 buổi weekly.
 *
 * Ví dụ trước (BUG):
 *   startDate=2025-06-19, endDate=2025-07-10, cycle=weekly
 *   → daysDiff = 21 < 28 → throw "tối thiểu 28 ngày" ← SAI
 *
 * Ví dụ sau (ĐÚNG):
 *   dates = [Jun 19, Jun 26, Jul 3, Jul 10] → length=4 → pass ✅
 */
export function validateFixedScheduleInput(input: {
  startDate: string;
  endDate: string;
  cycle: FixedScheduleCycle;
  timeStart: string;
  timeEnd: string;
}): void {
  const start = normalizeDate(input.startDate);
  const end = normalizeDate(input.endDate);

  // FIX #1: dùng ngày VN thay vì UTC
  const today = getTodayVN();

  if (start < today) {
    throw new BadRequestException('Ngày bắt đầu phải từ hôm nay trở đi');
  }
  if (end <= start) {
    throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
  }

  // Validate giờ trước khi generate dates (throw nếu giờ sai)
  buildHourSlots(input.timeStart, input.timeEnd);

  // FIX #2: đếm số buổi thực tế thay vì đo khoảng cách ngày
  const dates = generateFixedDates(input.startDate, input.endDate, input.cycle);

  if (input.cycle === FixedScheduleCycle.WEEKLY && dates.length < 4) {
    throw new BadRequestException(
      `Gói theo tuần tối thiểu 4 buổi. Hiện tại chỉ có ${dates.length} buổi trong khoảng đã chọn.`,
    );
  }
  if (input.cycle === FixedScheduleCycle.MONTHLY && dates.length < 2) {
    throw new BadRequestException(
      `Gói theo tháng tối thiểu 2 buổi. Hiện tại chỉ có ${dates.length} buổi trong khoảng đã chọn.`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// CODE GENERATORS
// ═══════════════════════════════════════════════════════════════

/**
 * Sinh invoice code: {PREFIX}-YYYYMMDD-XXXX
 */
export function invoiceCode(prefix: string): string {
  const now = new Date();
  const datePart = formatDate(now).replace(/-/g, '');
  const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${prefix}-${datePart}-${randomPart}`;
}

// ═══════════════════════════════════════════════════════════════
// DB-DEPENDENT HELPER
// ═══════════════════════════════════════════════════════════════

/**
 * Check slot conflict cho 1 court ở 1 ngày + danh sách giờ.
 */
export async function checkSlotConflict(
  client: DbClient,
  courtId: number,
  date: Date,
  hours: string[],
): Promise<ConflictSlot[]> {
  return client.courtSlot.findMany({
    where: {
      courtId,
      slotDate: date,
      time: { in: hours },
    },
    select: { time: true, status: true, bookedBy: true },
  });
}
