import {
  IsString, IsNumber, IsOptional,
  IsDateString, IsUUID, IsEnum, Matches, Min,
} from 'class-validator';

// ─────────────────────────────────────────────
// Tạo booking mới
// ─────────────────────────────────────────────
export class CreateBookingDto {
  @IsNumber()
  courtId: number;

  @IsDateString()
  bookingDate: string; // "2025-03-10"

  @IsString()
  @Matches(/^([01]\d|2[0-3]):00$/, { message: 'timeStart phải là HH:00, VD: 08:00' })
  timeStart: string; // "08:00"

  @IsString()
  @Matches(/^([01]\d|2[0-3]):00$/, { message: 'timeEnd phải là HH:00, VD: 10:00' })
  timeEnd: string; // "10:00"

  @IsNumber()
  @Min(1)
  @IsOptional()
  people?: number; // Số người chơi, mặc định 2

  @IsString()
  paymentMethod: string; // "cash" | "bank_transfer" | "momo"

  @IsString()
  customerName: string;

  @IsString()
  customerPhone: string;

  @IsString()
  @IsOptional()
  customerEmail?: string;

  @IsUUID()
  @IsOptional()
  userId?: string; // Nếu khách đã đăng nhập
}

// ─────────────────────────────────────────────
// Cập nhật trạng thái booking (Admin/Employee)
// ─────────────────────────────────────────────
export class UpdateBookingStatusDto {
  @IsEnum(['confirmed', 'playing', 'completed', 'cancelled'], {
    message: 'Status phải là: confirmed | playing | completed | cancelled',
  })
  status: string;
}

// ─────────────────────────────────────────────
// Filter khi lấy danh sách booking
// ─────────────────────────────────────────────
export class QueryBookingDto {
  @IsOptional()
  branchId?: string;

  @IsOptional()
  courtId?: string;

  @IsOptional()
  date?: string; // "2025-03-10"

  @IsOptional()
  status?: string;

  @IsOptional()
  phone?: string;
}