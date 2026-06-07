/**
 * Shared utilities cho module bookings.
 *
 * Các function này là PURE (không phụ thuộc Prisma/DI) → dễ unit test
 * và dùng chung được cho cả booking thường lẫn fixed schedule.
 *
 * Ngoại lệ: checkSlotConflict cần Prisma client → để ở đây vì có
 * 2 service (BookingsService + FixedScheduleService) cùng dùng.
 */

import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════════
// TYPE EXPORTS
// ═══════════════════════════════════════════════════════════════

/**
 * Type của Prisma client - chấp nhận cả PrismaService và TransactionClient.
 * Dùng cho các helper cần query DB trong/ngoài transaction.
 */
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
  date: string;
  dayLabel: string;
  timeStart: string;
  timeEnd: string;
  hasConflict: boolean;
  conflicts: ConflictSlot[];
  suggestedReplacement: SuggestedReplacement | null;
}

// ═══════════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Chuẩn hóa date về 00:00:00 UTC.
 * Tránh lệch timezone khi so sánh date.
 */
export function normalizeDate(value: string | Date): Date {
  const d = typeof value === 'string' ? new Date(value) : new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d;
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

// ═══════════════════════════════════════════════════════════════
// TIME SLOT HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Sinh danh sách slot 1 tiếng từ timeStart đến timeEnd.
 * Ví dụ: ("19:00", "21:00") → ["19:00", "20:00"]
 *
 * Lý do: hệ thống lưu CourtSlot theo từng giờ (1h/slot).
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

function getBusinessNowParts(now: Date): { dateToken: string; minutes: number } {
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
// OCCURRENCE GENERATION (Fixed Schedule - Weekly Slots)
// ═══════════════════════════════════════════════════════════════

export interface WeeklySlot {
  dayOfWeek: number; // 0=CN, 1=T2, 2=T3, 3=T4, 4=T5, 5=T6, 6=T7
  timeStart: string;
  timeEnd: string;
}

export interface SlotOccurrence {
  date: Date;
  timeStart: string;
  timeEnd: string;
}

/**
 * Tìm ngày đầu tiên >= startDate có dayOfWeek khớp với slot.
 */
export function getFirstOccurrenceOnOrAfter(startDate: Date, dayOfWeek: number): Date {
  const startDay = startDate.getUTCDay();
  let offset = dayOfWeek - startDay;
  if (offset < 0) offset += 7;
  return addDays(startDate, offset);
}

/**
 * Sinh danh sách buổi theo weeklySlots trong N tuần.
 * Mỗi slot (thứ + giờ) sẽ xuất hiện 1 lần/tuần × numberOfWeeks tuần.
 */
export function generateWeeklySlotDates(
  startDate: string,
  numberOfWeeks: number,
  weeklySlots: WeeklySlot[],
): SlotOccurrence[] {
  const start = normalizeDate(startDate);
  const occurrences: SlotOccurrence[] = [];

  for (const slot of weeklySlots) {
    const firstDate = getFirstOccurrenceOnOrAfter(start, slot.dayOfWeek);
    for (let week = 0; week < numberOfWeeks; week++) {
      occurrences.push({
        date: addDays(firstDate, week * 7),
        timeStart: slot.timeStart,
        timeEnd: slot.timeEnd,
      });
    }
  }

  // Sắp xếp theo ngày, sau đó theo giờ bắt đầu
  return occurrences.sort((a, b) => {
    const dateDiff = a.date.getTime() - b.date.getTime();
    if (dateDiff !== 0) return dateDiff;
    return a.timeStart.localeCompare(b.timeStart);
  });
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Validate input cho cả Preview và Confirm fixed schedule (weeklySlots model).
 */
export function validateWeeklySlotInput(input: {
  startDate: string;
  numberOfWeeks: number;
  weeklySlots: WeeklySlot[];
}): void {
  const start = normalizeDate(input.startDate);
  const today = normalizeDate(new Date());

  if (start < today) {
    throw new BadRequestException('Ngày bắt đầu phải từ hôm nay trở đi');
  }
  if (input.numberOfWeeks < 4) {
    throw new BadRequestException('Gói đặt sân cố định tối thiểu 4 tuần');
  }
  if (input.weeklySlots.length === 0) {
    throw new BadRequestException('Phải chọn ít nhất 1 buổi trong tuần');
  }

  // Kiểm tra không có thứ trùng
  const days = input.weeklySlots.map((s) => s.dayOfWeek);
  if (new Set(days).size !== days.length) {
    throw new BadRequestException('Mỗi thứ trong tuần chỉ được chọn một lần');
  }

  // Validate giờ từng slot + check giờ chưa qua nếu buổi đầu tiên là hôm nay
  for (const slot of input.weeklySlots) {
    // Throws nếu giờ không hợp lệ (end <= start)
    buildHourSlots(slot.timeStart, slot.timeEnd);

    // Nếu ngày đầu tiên của slot này là hôm nay → check giờ chưa qua
    const firstDate = getFirstOccurrenceOnOrAfter(start, slot.dayOfWeek);
    if (isSlotStartInPast(firstDate, slot.timeStart)) {
      const label = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][slot.dayOfWeek];
      throw new BadRequestException(
        `Khung giờ ${slot.timeStart} của ${label} đã qua, vui lòng chọn giờ khác`,
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// CODE GENERATORS
// ═══════════════════════════════════════════════════════════════

/**
 * Sinh invoice code: {PREFIX}-YYYYMMDD-XXXX
 * - BK: Booking thường
 * - FS: Fixed Schedule
 * - OD: Order
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
// DB-DEPENDENT HELPER (shared)
// ═══════════════════════════════════════════════════════════════

/**
 * Check slot conflict cho 1 court ở 1 ngày + danh sách giờ.
 * Dùng được cả trong và ngoài transaction.
 *
 * @param client - PrismaService hoặc TransactionClient
 * @param courtId - ID của sân
 * @param date - Ngày (đã normalize)
 * @param hours - Danh sách giờ ["19:00", "20:00"]
 * @returns Mảng slot đang bị đặt/hold (rỗng = không conflict)
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
