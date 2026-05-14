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
import { FixedScheduleCycle } from './dto/booking.dto';

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

// ═══════════════════════════════════════════════════════════════
// OCCURRENCE GENERATION (Fixed Schedule)
// ═══════════════════════════════════════════════════════════════

/**
 * Sinh danh sách ngày theo cycle:
 * - weekly: lặp mỗi 7 ngày
 * - monthly: lặp mỗi 28 ngày (4 tuần) - cố định để dễ tính giá
 */
export function generateFixedDates(
  startDate: string,
  endDate: string,
  cycle: FixedScheduleCycle,
): Date[] {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  const step = cycle === FixedScheduleCycle.WEEKLY ? 7 : 28;

  const dates: Date[] = [];
  let cursor = new Date(start);

  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor = addDays(cursor, step);
  }
  return dates;
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Validate input cho cả Preview và Confirm fixed schedule.
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
  const today = normalizeDate(new Date());

  if (start < today) {
    throw new BadRequestException('Ngày bắt đầu phải từ hôm nay trở đi');
  }
  if (end <= start) {
    throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
  }

  const daysDiff = Math.ceil(
    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (input.cycle === FixedScheduleCycle.WEEKLY && daysDiff < 28) {
    throw new BadRequestException('Gói theo tuần tối thiểu 4 tuần (28 ngày)');
  }
  if (input.cycle === FixedScheduleCycle.MONTHLY && daysDiff < 56) {
    throw new BadRequestException(
      'Gói theo tháng tối thiểu 2 chu kỳ (56 ngày)',
    );
  }

  // Throw nếu giờ sai
  buildHourSlots(input.timeStart, input.timeEnd);
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
export function invoiceCode(prefix: string): string {
  const now = new Date();
  const datePart = formatDate(now).replace(/-/g, '');
  const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${prefix}-${datePart}-${randomPart}`;
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