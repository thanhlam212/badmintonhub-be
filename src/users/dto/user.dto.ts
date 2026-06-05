import {
  IsString, IsEmail, IsOptional, IsEnum, IsDateString,
  IsInt, MinLength, Matches, Min,
} from 'class-validator'
import { Type } from 'class-transformer'

// FE gửi snake_case
export class CreateUserDto {
  @IsString()
  username: string

  @IsString()
  @MinLength(6)
  @Matches(/^[\x00-\x7F]+$/, { message: 'password không được dùng ký tự có dấu hoặc ký tự đặc biệt Unicode' })
  password: string

  @IsString()
  full_name: string

  @IsEmail()
  email: string

  @IsString()
  phone: string

  @IsEnum(['user', 'admin', 'employee'], { message: 'role phải là user, admin, hoặc employee' })
  @IsOptional()
  role?: string

  @IsString()
  @IsOptional()
  address?: string

  @IsEnum(['nam', 'nu', 'nữ'])
  @IsOptional()
  gender?: string

  @IsDateString()
  @IsOptional()
  date_of_birth?: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  warehouse_id?: number
}

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  full_name?: string

  @IsEmail()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  phone?: string

  @IsEnum(['user', 'admin', 'employee'])
  @IsOptional()
  role?: string

  @IsString()
  @IsOptional()
  address?: string

  @IsEnum(['nam', 'nu', 'nữ'])
  @IsOptional()
  gender?: string

  @IsDateString()
  @IsOptional()
  date_of_birth?: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  warehouse_id?: number | null
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(6)
  @Matches(/^[\x00-\x7F]+$/, { message: 'new_password không được dùng ký tự có dấu hoặc ký tự đặc biệt Unicode' })
  new_password: string
}
