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

export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export function getBusinessNowParts(now: Date): { dateToken: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value || '0';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));

  return {
    dateToken: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: hour * 60 + minute,
  };
}

export function isSlotStartInPast(
  slotDate: Date,
  time: string,
  now: Date = new Date(),
): boolean {
  const slotDateToken = formatDate(slotDate);
  const current = getBusinessNowParts(now);
  if (slotDateToken < current.dateToken) return true;
  if (slotDateToken > current.dateToken) return false;

  const [hour, minute = 0] = time.split(':').map(Number);
  return hour * 60 + minute <= current.minutes;
}

export function assertSlotNotPast(date: Date, time: string): void {
  if (isSlotStartInPast(date, time)) {
    throw new BadRequestException('Khung giờ đã qua, vui lòng chọn khung giờ khác');
  }
}

// ═══════════════════════════════════════════════════════════════
// OCCURRENCE GENERATION
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// CODE GENERATORS
// ═══════════════════════════════════════════════════════════════

/**
 * Sinh invoice code: {PREFIX}-YYYYMMDD-XXXX
 */
export const DOCUMENT_CODE_PATTERN = /^(MB|BK|FS|OD|SO)-\d{8}-\d{4}$/i;

export function invoiceCode(prefix: string, seq?: number, date: Date = new Date()): string {
  const cleanPrefix = String(prefix || '').trim().toUpperCase();
  if (!/^(MB|BK|FS|OD|SO)$/.test(cleanPrefix)) {
    throw new BadRequestException('Prefix mã chứng từ không hợp lệ');
  }

  const datePart = formatDate(date).replace(/-/g, '');
  const numericSeq = typeof seq === 'number'
    ? seq
    : Math.floor(Math.random() * 10000);
  const seqPart = String(Math.max(0, numericSeq) % 10000).padStart(4, '0');
  return `${cleanPrefix}-${datePart}-${seqPart}`;
}

export function fallbackDocumentCode(
  prefix: string,
  source: { id?: string | null; createdAt?: Date | string | null },
): string {
  const date = source.createdAt ? new Date(source.createdAt) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const normalized = String(source.id || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  let seq = 0;
  for (const ch of normalized) {
    seq = (seq * 31 + ch.charCodeAt(0)) % 10000;
  }
  return invoiceCode(prefix, seq, safeDate);
}

export async function nextInvoiceCode(
  client: DbClient,
  prefix: 'MB' | 'BK' | 'FS' | 'OD' | 'SO',
  date: Date = new Date(),
): Promise<string> {
  const datePart = formatDate(date).replace(/-/g, '');
  const codePrefix = `${prefix}-${datePart}-`;
  const latest = await client.invoice.findFirst({
    where: { code: { startsWith: codePrefix } },
    select: { code: true },
    orderBy: { code: 'desc' },
  });

  const parsedLatestSeq = latest?.code ? Number.parseInt(latest.code.slice(-4), 10) : 0;
  const latestSeq = Number.isFinite(parsedLatestSeq) ? parsedLatestSeq : 0;
  for (let seq = latestSeq + 1; seq <= 9999; seq++) {
    const code = invoiceCode(prefix, seq, date);
    const existing = await client.invoice.findFirst({
      where: { code },
      select: { id: true },
    });
    if (!existing) return code;
  }

  throw new BadRequestException(`Đã hết dải mã ${prefix} trong ngày ${datePart}`);
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

export const HOLD_EXPIRES_MINUTES = 10;

export async function expireStaleBookingHolds(
  client: DbClient,
  now: Date = new Date(),
): Promise<number> {
  const expiresBefore = new Date(now.getTime() - HOLD_EXPIRES_MINUTES * 60 * 1000);
  const where: any = {
    status: 'hold',
    createdAt: { lt: expiresBefore },
    booking: {
      is: {
        status: 'pending',
        fixedScheduleId: null,
        fixedOccurrenceId: null,
      },
    },
  };

  const staleSlots = await client.courtSlot.findMany({
    where,
    select: { bookingId: true },
  }) || [];
  const staleUnpaidBookings = await client.booking.findMany({
    where: {
      status: 'pending',
      createdAt: { lt: expiresBefore },
      fixedScheduleId: null,
      fixedOccurrenceId: null,
      invoices: { some: { status: 'unpaid' } },
    },
    select: { id: true },
  }) || [];
  const bookingIds = Array.from(
    new Set([
      ...(staleSlots.map((slot) => slot.bookingId).filter(Boolean) as string[]),
      ...staleUnpaidBookings.map((booking) => booking.id),
    ]),
  );

  if (bookingIds.length === 0) return 0;

  const deletedSlots = await client.courtSlot.deleteMany({
    where: {
      OR: [
        where,
        { bookingId: { in: bookingIds }, status: 'hold' },
      ],
    },
  });

  await client.booking.updateMany({
    where: {
      id: { in: bookingIds },
      status: 'pending',
      fixedScheduleId: null,
      fixedOccurrenceId: null,
    },
    data: { status: 'cancelled' },
  });

  await client.invoice.updateMany({
    where: {
      bookingId: { in: bookingIds },
      status: 'unpaid',
    },
    data: { status: 'cancelled' },
  });

  return deletedSlots.count;
}
