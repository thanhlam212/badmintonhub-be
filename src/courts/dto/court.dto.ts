import {
  IsString, IsNumber, IsBoolean,
  IsOptional, IsArray, IsEnum, Min,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

// Enum giới hạn type chỉ nhận 3 giá trị cố định
export enum CourtType {
  STANDARD = 'standard',
  PREMIUM  = 'premium',
  VIP      = 'vip',
}

export class CreateCourtDto {
  @IsString()
  name: string;         // "Sân A1 - Premium"

  @IsNumber()
  branchId: number;     // ID chi nhánh sân thuộc về

  @IsEnum(CourtType)    // ← Chỉ nhận: 'standard' | 'premium' | 'vip'
  @IsOptional()
  type?: CourtType;

  @IsBoolean()
  @IsOptional()
  indoor?: boolean;     // true = trong nhà, false = ngoài trời

  @IsNumber()
  @Min(0)               // ← Giá phải >= 0, không âm
  price: number;        // Giá/giờ (VNĐ): 160000

  @IsString()
  @IsOptional()
  image?: string;       // URL ảnh sân

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  hours?: string;       // "06:00 - 22:00"

  @IsArray()            // ← Phải là mảng
  @IsString({ each: true }) // ← Mỗi phần tử trong mảng phải là string
  @IsOptional()
  amenities?: string[]; // ["Điều hòa", "Đèn LED", "Sàn gỗ"]
}

export class UpdateCourtDto extends PartialType(CreateCourtDto) {}

// DTO riêng cho review — dùng ở endpoint POST /courts/:id/reviews
export class CreateReviewDto {
  @IsNumber()
  @Min(1)               // ← Rating từ 1 đến 5
  rating: number;

  @IsString()
  @IsOptional()
  content?: string;     // Nội dung đánh giá (có thể để trống)
}