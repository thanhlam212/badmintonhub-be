import { PartialType } from '@nestjs/mapped-types';
import { IsString, IsNumber, IsBoolean, IsOptional, IsEmail } from 'class-validator';

export class CreateBranchDto {
  @IsString()          // ← Bắt buộc phải là chuỗi
  name: string;        // Tên chi nhánh: "BadmintonHub Cầu Giấy"

  @IsString()
  address: string;     // Địa chỉ đầy đủ

  @IsNumber()          // ← Bắt buộc phải là số
  lat: number;         // Vĩ độ: 21.0285

  @IsNumber()
  lng: number;         // Kinh độ: 105.7823

  @IsString()
  @IsOptional()        // ← Không bắt buộc, có thể bỏ qua
  phone?: string;

  @IsEmail()           // ← Phải đúng định dạng email
  @IsOptional()
  email?: string;

  @IsBoolean()         // ← Phải là true/false
  @IsOptional()
  isActive?: boolean;
}

// PartialType → UpdateBranchDto có TẤT CẢ field của Create
// nhưng tất cả đều @IsOptional() — chỉ gửi field nào cần sửa
export class UpdateBranchDto extends PartialType(CreateBranchDto) {}