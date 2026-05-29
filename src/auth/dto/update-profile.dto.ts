import { IsString, IsEmail, IsOptional, IsDateString, IsEnum, MinLength, Matches } from 'class-validator';

/**
 * FE gửi snake_case: full_name, date_of_birth, ...
 * forbidNonWhitelisted=true → chỉ cho phép các field được khai báo ở đây.
 */
export class UpdateProfileDto {
  @IsString()
  @MinLength(2)
  @IsOptional()
  full_name?: string;

  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsOptional()
  email?: string;

  @IsString()
  @Matches(/^(0[3|5|7|8|9])+([0-9]{8})$/, { message: 'Số điện thoại Việt Nam không hợp lệ' })
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsEnum(['nam', 'nu', 'nữ'], { message: 'Giới tính phải là nam hoặc nữ' })
  @IsOptional()
  gender?: string;

  @IsDateString({}, { message: 'Ngày sinh không hợp lệ' })
  @IsOptional()
  date_of_birth?: string;
}
