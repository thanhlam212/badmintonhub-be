import { Controller, Post, Get, Put, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/changePasword.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CurrentUser, Public } from './decorators/index';
import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';

class ForgotPasswordDto {
  @IsString() @IsNotEmpty()
  phone: string
}

class ResetPasswordDto {
  @IsString() @IsNotEmpty()
  phone: string
  @IsString() @IsNotEmpty()
  otp: string
  @IsString() @MinLength(6)
  new_password: string
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /api/auth/register  (public)
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 3 } })  // 3 req / 60s — chống spam tạo tài khoản
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // POST /api/auth/login  (public)
  // FE gửi { username, password }, trả về { token, user (snake_case) }
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })  // 5 req / 60s — chống brute-force mật khẩu
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // GET /api/auth/me  (cần token)
  // Trả về user object (snake_case) — interceptor bọc thành { success: true, data: user }
  @Get('me')
  getMe(@CurrentUser() user: any) {
    return this.authService.getProfile(user.id);
  }

  // PUT /api/auth/me  (cần token)
  // FE gửi { full_name, email, phone, address, gender, date_of_birth }
  @Put('me')
  updateMe(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto);
  }

  // GET /api/auth/profile  (alias của /me, giữ backward compat)
  @Get('profile')
  getProfile(@CurrentUser() user: any) {
    return this.authService.getProfile(user.id);
  }

  // PUT /api/auth/change-password  (cần token)
  // FE gửi { current_password, new_password }
  @Put('change-password')
  changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto.current_password, dto.new_password);
  }

  // POST /api/auth/forgot-password  (public)
  // FE gửi { phone } → BE gửi OTP qua email
  @Public()
  @Throttle({ default: { ttl: 300000, limit: 3 } })  // 3 req / 5 phút — chống spam OTP
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.phone);
  }

  // POST /api/auth/reset-password  (public)
  // FE gửi { phone, otp, new_password }
  @Public()
  @Throttle({ default: { ttl: 300000, limit: 5 } })  // 5 req / 5 phút — chống brute-force OTP
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.phone, dto.otp, dto.new_password);
  }
}
