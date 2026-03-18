import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser, Public } from './decorators/index';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/changePasword.dto';



@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}
    
    // Đăng ký tài khoản mới
    @Public()
    @Post('register')
        register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    // dang nhap
    @Public()
    @Post('login')
    login(@Body() dto: LoginDto) {
        return this.authService.login(dto);
    }

    // Lấy thông tin user hiện tại
    @Get('profile')
    getProfile(@CurrentUser() user: any) {
        return this.authService.getProfile(user.id);
    }

    @Patch('change-password')
  changePassword(
    @CurrentUser() user: any,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.id,
      dto.oldPassword,
      dto.newPassword,
    );
  }

  // ─────────────────────────────────────
  // GET /api/auth/me  (Cần token)
  // Trả nhanh user từ token (không query DB)
  // ─────────────────────────────────────
  @Get('me')
  getMe(@CurrentUser() user: any) {
    return user;
  }
}   
