import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsEnum,
  IsEmail,
  IsOptional,
  IsDateString,
  Min,
  Max,
  Matches,
  ValidateNested,
  IsArray,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

// ═══════════════════════════════════════════════════════════════
// SECTION 1: ENUMS
// ═══════════════════════════════════════════════════════════════

export enum FixedScheduleCycle {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export enum FixedScheduleBookingMode {
  OCCURRENCE_COUNT = 'occurrence_count',
  DATE_RANGE = 'date_range',
}

export enum PaymentMethod {
  CASH = 'cash',
  BANK_TRANSFER = 'bank_transfer',
  MOMO = 'momo',
  VNPAY = 'vnpay',
}

export enum BookingStatus {
  PENDING = 'pending',
  DEPOSITED = 'deposited',
  CONFIRMED = 'confirmed',
  PLAYING = 'playing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

/**
 * Action cho từng occurrence khi confirm gói:
 * - keep:    Giữ buổi gốc (court & time như đăng ký ban đầu)
 * - replace: Chuyển sang sân khác cùng ngày, cùng giờ (bù miễn phí - BE gợi ý)
 * - custom:  User tự chọn sân + giờ hoàn toàn khác (đổi giờ + đổi sân)
 * - skip:    Bỏ buổi này, không tạo booking
 */
export enum OccurrenceAction {
  KEEP = 'keep',
  REPLACE = 'replace',
  CUSTOM = 'custom',
  SKIP = 'skip',
}

/**
 * Loại điều chỉnh sau khi đã confirm gói (dùng quota adjustment):
 * - skip:         Báo nghỉ buổi
 * - reschedule:   Đổi sang ngày khác (cùng sân)
 * - change_court: Đổi sang sân khác (cùng ngày/giờ)
 */
export enum FixedAdjustmentType {
  SKIP = 'skip',
  RESCHEDULE = 'reschedule',
  CHANGE_COURT = 'change_court',
}

// ═══════════════════════════════════════════════════════════════
// SECTION 2: BOOKING THƯỜNG (giữ nguyên)
// ═══════════════════════════════════════════════════════════════

// FE gửi snake_case: court_id, booking_date, time_start, time_end, customer_name, ...
export class CreateBookingDto {
  /** ID sân — FE gửi court_id */
  @IsInt()
  @Min(1)
  court_id: number;

  /** Ngày đặt YYYY-MM-DD — FE gửi booking_date */
  @IsDateString({}, { message: 'Ngày đặt phải đúng định dạng YYYY-MM-DD' })
  @IsNotEmpty()
  booking_date: string;

  /** Giờ bắt đầu HH:mm — FE gửi time_start */
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Giờ bắt đầu phải đúng định dạng HH:mm',
  })
  time_start: string;

  /** Giờ kết thúc HH:mm — FE gửi time_end */
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Giờ kết thúc phải đúng định dạng HH:mm',
  })
  time_end: string;

  /** Số người / số slots — FE gửi slots */
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  slots?: number;

  /** Giữ backward compat nếu gửi people */
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  people?: number;

  /** Phương thức thanh toán — FE gửi payment_method (string) */
  @IsString()
  @IsOptional()
  payment_method?: string;

  /** Tên khách hàng — FE gửi customer_name */
  @IsString()
  @IsNotEmpty({ message: 'Tên khách hàng không được để trống' })
  customer_name: string;

  /** SĐT khách — FE gửi customer_phone */
  @IsString()
  @IsNotEmpty()
  customer_phone: string;

  /** Email khách (optional) — FE gửi customer_email */
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  @IsOptional()
  customer_email?: string;

  /** User ID (optional) — FE gửi user_id */
  @IsString()
  @IsOptional()
  user_id?: string;

  /** Tổng tiền FE tính sẵn — BE bỏ qua, tự tính từ giá sân */
  @IsOptional()
  amount?: number;

  /** Ghi chú */
  @IsString()
  @IsOptional()
  note?: string;
}

// ─── Tạo giữ chỗ / hold — cùng struct với CreateBookingDto ────
// Dùng lại CreateBookingDto (alias)
export { CreateBookingDto as CreateHoldDto };

// ─── Tạo booking lặp lại (recurring) theo số tuần ────────────
export class CreateRecurringDto {
  @IsInt()
  @Min(1)
  court_id: number;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  time_start: string;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  time_end: string;

  @IsDateString()
  start_date: string;

  @IsInt()
  @Min(1)
  @Max(52)
  weeks: number;

  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  slots?: number;

  @IsString()
  @IsNotEmpty()
  customer_name: string;

  @IsString()
  @IsNotEmpty()
  customer_phone: string;

  @IsEmail()
  @IsOptional()
  customer_email?: string;

  @IsOptional()
  amount?: number;

  @IsString()
  @IsOptional()
  payment_method?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  user_id?: string;
}

// ─── Cập nhật service lines của booking ───────────────────────
export class UpdateServicesDto {
  @IsOptional()
  service_lines?: any[];

  @IsString()
  @IsOptional()
  paid_hash?: string | null;

  @IsString()
  @IsOptional()
  paid_at?: string | null;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 3: FIXED SCHEDULE - PREVIEW
// ═══════════════════════════════════════════════════════════════

/**
 * Bước 1: Khách điền form đặt lịch cố định.
 * KHÔNG cần thông tin khách ở bước này → chỉ check conflict + tính giá.
 * Thông tin khách sẽ điền ở bước Confirm.
 */
export class FixedScheduleRuleDto {
  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  dayOfWeek?: number;

  @IsInt()
  @Min(1)
  @Max(31)
  @IsOptional()
  dayOfMonth?: number;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):00$/, {
    message: 'Giờ bắt đầu phải là giờ tròn, định dạng HH:00',
  })
  timeStart: string;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):00$/, {
    message: 'Giờ kết thúc phải là giờ tròn, định dạng HH:00',
  })
  timeEnd: string;
}

export class FixedSchedulePreviewDto {
  @IsInt({ message: 'ID sân phải là số nguyên' })
  @Min(1, { message: 'ID sân không hợp lệ' })
  courtId: number;

  @IsEnum(FixedScheduleCycle, {
    message: 'Chu kỳ phải là "weekly" hoặc "monthly"',
  })
  cycle: FixedScheduleCycle;

  @IsEnum(FixedScheduleBookingMode)
  @IsOptional()
  bookingMode?: FixedScheduleBookingMode;

  @IsDateString({}, { message: 'Ngày bắt đầu phải đúng định dạng YYYY-MM-DD' })
  startDate: string;

  @IsDateString({}, { message: 'Ngày kết thúc phải đúng định dạng YYYY-MM-DD' })
  @IsOptional()
  endDate?: string;

  @IsInt()
  @Min(2)
  @Max(52)
  @IsOptional()
  occurrenceCount?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FixedScheduleRuleDto)
  @IsOptional()
  rules?: FixedScheduleRuleDto[];

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Giờ bắt đầu phải đúng định dạng HH:mm',
  })
  @IsOptional()
  timeStart?: string;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Giờ kết thúc phải đúng định dạng HH:mm',
  })
  @IsOptional()
  timeEnd?: string;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 4: FIXED SCHEDULE - CONFIRM
// ═══════════════════════════════════════════════════════════════

/**
 * Quyết định của user cho từng occurrence khi confirm.
 *
 * Lưu ý:
 * - KHÔNG có pricePerHour, amount, courtName, slots, conflicts...
 *   → BE tự lấy từ DB để chống FE "chế" giá trị.
 * - Field replaceWithCourtId CHỈ required khi action = 'replace'.
 * - BE sẽ re-validate: nếu action=replace mà courtId trùng court gốc,
 *   hoặc sân thay thế không available → reject.
 */
export class OccurrenceDecisionDto {
  @IsDateString({}, { message: 'Ngày phải đúng định dạng YYYY-MM-DD' })
  date: string;

  @IsEnum(OccurrenceAction, {
    message: 'Action phải là "keep", "replace", "custom" hoặc "skip"',
  })
  action: OccurrenceAction;

  /**
   * ID sân thay thế.
   * - action='replace': BE gợi ý sân cùng type, cùng giờ gốc
   * - action='custom': User tự chọn bất kỳ sân cùng type trong branch
   */
  @IsInt()
  @Min(1)
  @IsOptional()
  replaceWithCourtId?: number;

  /**
   * Giờ mới khi action='custom'.
   * Nếu không truyền → BE dùng giờ gốc của gói.
   */
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Giờ bắt đầu mới phải đúng định dạng HH:mm',
  })
  @IsOptional()
  customTimeStart?: string;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Giờ kết thúc mới phải đúng định dạng HH:mm',
  })
  @IsOptional()
  customTimeEnd?: string;

  /**
   * Lý do skip (tùy chọn, để audit log).
   */
  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Bước 2: User chốt gói sau khi xem preview.
 * - decisions[]: mảng quyết định cho từng buổi
 * - BE sẽ map decisions với occurrences đã sinh ra ở /preview
 */
export class FixedScheduleConfirmDto {
  // ─── Thông tin gói (giống Preview) ───
  @IsInt()
  @Min(1)
  courtId: number;

  @IsEnum(FixedScheduleCycle)
  cycle: FixedScheduleCycle;

  @IsEnum(FixedScheduleBookingMode)
  @IsOptional()
  bookingMode?: FixedScheduleBookingMode;

  @IsDateString()
  startDate: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsInt()
  @Min(2)
  @Max(52)
  @IsOptional()
  occurrenceCount?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FixedScheduleRuleDto)
  @IsOptional()
  rules?: FixedScheduleRuleDto[];

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  @IsOptional()
  timeStart?: string;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  @IsOptional()
  timeEnd?: string;

  // ─── Thông tin khách hàng ───
  @IsString()
  @IsNotEmpty({ message: 'Tên khách hàng không được để trống' })
  customerName: string;

  @IsString()
  @Matches(/^(0[3|5|7|8|9])+([0-9]{8})$/, {
    message: 'Số điện thoại không hợp lệ',
  })
  customerPhone: string;

  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsOptional()
  customerEmail?: string;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsString()
  @IsOptional()
  userId?: string;

  // ─── Decisions cho từng occurrence ───
  @IsArray()
  @ArrayMinSize(1, { message: 'Phải có ít nhất 1 buổi' })
  @ValidateNested({ each: true })
  @Type(() => OccurrenceDecisionDto)
  decisions: OccurrenceDecisionDto[];

  // ─── Tùy chọn nâng cao ───
  @IsInt()
  @Min(0)
  @Max(5)
  @IsOptional()
  adjustmentLimit?: number; // Mặc định: 2 (monthly) / 1 (weekly)
}

// ═══════════════════════════════════════════════════════════════
// SECTION 5: FIXED SCHEDULE - ADJUST (sau khi đã confirm gói)
// ═══════════════════════════════════════════════════════════════

/**
 * Khách đã mua gói rồi, muốn điều chỉnh 1 buổi cụ thể.
 * Mỗi gói có quota adjustmentLimit, dùng hết là không adjust được nữa.
 */
export class FixedScheduleAdjustDto {
  @IsEnum(FixedAdjustmentType, {
    message: 'Loại điều chỉnh phải là "skip", "reschedule" hoặc "change_court"',
  })
  type: FixedAdjustmentType;

  @IsInt()
  @Min(1)
  @IsOptional()
  newCourtId?: number;

  @IsDateString()
  @IsOptional()
  newDate?: string;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  @IsOptional()
  newTimeStart?: string;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  @IsOptional()
  newTimeEnd?: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 6: CHECK SLOT AVAILABILITY
// ═══════════════════════════════════════════════════════════════

/**
 * Dùng trong modal "Đổi giờ" ở FE:
 * Khi user nhập giờ mới + chọn sân, FE gọi API này để kiểm tra
 * slot đó có available không trước khi confirm.
 */
export class CheckSlotDto {
  @IsInt()
  @Min(1)
  courtId: number;

  @IsDateString()
  date: string;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  timeStart: string;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
  timeEnd: string;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 7: UPDATE STATUS
// ═══════════════════════════════════════════════════════════════

export class UpdateBookingStatusDto {
  @IsEnum(BookingStatus, { message: 'Trạng thái không hợp lệ' })
  status: BookingStatus;
}
