import { IsString, 
        MinLength, 
        MaxLength, 
        Matches, 
        IsEmail, 
        IsOptional, 
        IsEnum, 
        IsDateString 
    } from "class-validator";

export class  RegisterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username: string;

  @IsString()
  @MinLength(6)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Mật khẩu phải có ít nhất 1 chữ cái và 1 số',
  })
  password: string;

  @IsString()
  @MinLength(2)
  fullName: string;

  @IsEmail({}, { message: 'Email không hợp lệ' })
  email: string;

  @IsString()
  @Matches(/^(0[3|5|7|8|9])+([0-9]{8})$/, {
    message: 'Số điện thoại Việt Nam không hợp lệ',
  })
  phone: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsEnum(['nam', 'nu'], { message: 'Giới tính phải là nam hoặc nu' })
  @IsOptional()
  gender?: 'nam' | 'nu';

  @IsDateString({}, { message: 'Ngày sinh không hợp lệ' })
  @IsOptional()
  dateOfBirth?: string;
}