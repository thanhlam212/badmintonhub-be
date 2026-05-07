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
  IsBoolean,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─────────────────────────────────────────────────────
// Enum định nghĩa
// ─────────────────────────────────────────────────────
export enum FixedScheduleCycle {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
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

// ─────────────────────────────────────────────────────
// DTO cho đặt sân thường
// ─────────────────────────────────────────────────────
export class CreateBookingDto {
  @IsInt()
  @Min(1)
  courtId: number;

  @IsDateString()
  @IsNotEmpty({ message: 'Ngày đặt sân không được để trống' })
  bookingDate: string;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Giờ bắt đầu phải đúng định dạng HH:mm (ví dụ: 08:00)',
  })
  timeStart: string;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Giờ kết thúc phải đúng định dạng HH:mm (ví dụ: 10:00)',
  })
  timeEnd: string;

  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  people?: number;

  @IsEnum(PaymentMethod, {
    message: 'Phương thức thanh toán không hợp lệ',
  })
  paymentMethod: string;

  @IsString()
  @IsNotEmpty({ message: 'Tên khách hàng không được để trống' })
  customerName: string;

  @IsString()
  @Matches(/^(0[3|5|7|8|9])+([0-9]{8})$/, {
    message: 'Số điện thoại phải đúng định dạng Việt Nam (ví dụ: 0901234567)',
  })
  customerPhone: string;

  @IsEmail({}, { message: 'Email không đúng định dạng' })
  @IsOptional()
  customerEmail?: string;

  @IsString()
  @IsOptional()
  userId?: string;
}

// ─────────────────────────────────────────────────────
// DTO cho Preview Fixed Schedule
// ─────────────────────────────────────────────────────
export class FixedSchedulePreviewDto {
  @IsInt()
  @Min(1, { message: 'ID sân không hợp lệ' })
  courtId: number;

  @IsEnum(FixedScheduleCycle, {
    message: 'Chu kỳ phải là "weekly" hoặc "monthly"',
  })
  cycle: FixedScheduleCycle;

  @IsDateString({}, { message: 'Ngày bắt đầu phải đúng định dạng ISO (YYYY-MM-DD)' })
  startDate: string;

  @IsDateString({}, { message: 'Ngày kết thúc phải đúng định dạng ISO (YYYY-MM-DD)' })
  endDate: string;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Giờ bắt đầu phải đúng định dạng HH:mm',
  })
  timeStart: string;

  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'Giờ kết thúc phải đúng định dạng HH:mm',
  })
  timeEnd: string;

  @IsString()
  @IsOptional()  
  customerName?: string;

  @IsString()
  @Matches(/^(0[3|5|7|8|9])+([0-9]{8})$/)
  @IsOptional()  
  customerPhone?: string;

  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsOptional()
  customerEmail?: string;

  @IsString()
  @IsOptional()
  userId?: string;
}

// ─────────────────────────────────────────────────────
// DTO cho từng occurrence trong fixed schedule
// ─────────────────────────────────────────────────────
export class OccurrenceDto {
  @IsDateString()
  date: string;

  @IsString()
  dayLabel: string;

  @IsInt()
  courtId: number;

  @IsString()
  courtName: string;

  @IsString()
  timeStart: string;

  @IsString()
  timeEnd: string;

  @IsArray()
  @IsString({ each: true })
  slots: string[];

  @IsBoolean()
  available: boolean;

  @IsArray()
  conflicts: any[];

  @IsNumber()
  pricePerHour: number;

  @IsNumber()
  amount: number;

  @IsBoolean()
  skip: boolean;

  // Cho phép điều chỉnh
  @IsInt()
  @IsOptional()
  adjustedCourtId?: number;

  @IsString()
  @IsOptional()
  adjustedTimeStart?: string;

  @IsString()
  @IsOptional()
  adjustedTimeEnd?: string;
}

// ─────────────────────────────────────────────────────
// DTO cho Confirm Fixed Schedule
// ─────────────────────────────────────────────────────
export class FixedScheduleConfirmDto {
  @IsInt()
  courtId: number;

  @IsEnum(FixedScheduleCycle)
  cycle: FixedScheduleCycle;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsString()
  timeStart: string;

  @IsString()
  timeEnd: string;

  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsString()
  @Matches(/^(0[3|5|7|8|9])+([0-9]{8})$/)
  customerPhone: string;

  @IsEmail()
  @IsOptional()
  customerEmail?: string;

  @IsEnum(PaymentMethod)
  paymentMethod: string;

  @IsString()
  @IsOptional()
  userId?: string;

  @ValidateNested({ each: true })
  @Type(() => OccurrenceDto)
  @IsArray()
  occurrences: OccurrenceDto[];

  @IsInt()
  @Min(0, { message: 'Số lần điều chỉnh tối thiểu là 0' })
  @Max(5, { message: 'Số lần điều chỉnh tối đa là 5' })
  @IsOptional()
  adjustmentLimit?: number; // ✨ MỚI: Cho phép cấu hình

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  discountRate?: number; // ✨ MỚI: Giảm giá cho gói (0-1, ví dụ 0.1 = giảm 10%)
}

// ─────────────────────────────────────────────────────
// DTO cho Adjustment
// ─────────────────────────────────────────────────────
export class FixedScheduleAdjustDto {
  @IsEnum(['skip', 'reschedule', 'change_court'])
  type: 'skip' | 'reschedule' | 'change_court';

  @IsInt()
  @IsOptional()
  newCourtId?: number;

  @IsDateString()
  @IsOptional()
  newDate?: string;

  @IsString()
  @IsOptional()
  newTimeStart?: string;

  @IsString()
  @IsOptional()
  newTimeEnd?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

// ─────────────────────────────────────────────────────
// DTO cho Update Status
// ─────────────────────────────────────────────────────
export class UpdateBookingStatusDto {
  @IsEnum(BookingStatus, {
    message: 'Trạng thái không hợp lệ',
  })
  status: BookingStatus;
}