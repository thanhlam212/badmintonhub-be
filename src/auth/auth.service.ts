import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

// ── OTP in-memory store (phone → { otp, expiresAt, username }) ──────────────
const OTP_STORE = new Map<string, { otp: string; expiresAt: number; username: string }>();
const OTP_TTL_MS = 5 * 60 * 1000; // 5 phút

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  // ──────────────────────────────────────────────────────────────
  // HELPER: Map Prisma user object → snake_case (FE expects này)
  // ──────────────────────────────────────────────────────────────
  private mapUser(user: any) {
    return {
      id: user.id,
      user_code: '',          // Không có trong schema, FE dùng fallback ''
      username: user.username,
      full_name: user.fullName,
      email: user.email,
      phone: user.phone,
      address: user.address ?? null,
      gender: user.gender ?? null,
      date_of_birth: user.dateOfBirth
        ? new Date(user.dateOfBirth).toISOString().split('T')[0]
        : null,
      role: user.role,
      warehouse_id: user.warehouseId ?? null,
      created_at: user.createdAt,
      updated_at: user.updatedAt ?? user.createdAt,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // HELPER: Tạo JWT token
  // ──────────────────────────────────────────────────────────────
  private generateToken(userId: string, username: string, role: string, warehouseId: number | null) {
    const payload = { sub: userId, username, role, warehouseId };
    return this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_EXPIRES_IN') || '7d',
    });
  }

  // ──────────────────────────────────────────────────────────────
  // ĐĂNG KÝ
  // ──────────────────────────────────────────────────────────────
  async register(dto: RegisterDto) {
    // Kiểm tra trùng username / email / phone
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: dto.username },
          { email: dto.email },
          { phone: dto.phone },
        ],
      },
    });

    if (existing) {
      if (existing.username === dto.username)
        throw new ConflictException('Username đã tồn tại');
      if (existing.email === dto.email)
        throw new ConflictException('Email đã được đăng ký');
      if (existing.phone === dto.phone)
        throw new ConflictException('Số điện thoại đã được đăng ký');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
        fullName: (dto as any).full_name || (dto as any).fullName || '',
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        gender: dto.gender as any,
        dateOfBirth: ((dto as any).date_of_birth || (dto as any).dateOfBirth)
          ? new Date((dto as any).date_of_birth || (dto as any).dateOfBirth)
          : undefined,
        role: 'user',
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        address: true,
        gender: true,
        dateOfBirth: true,
        role: true,
        warehouseId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const token = this.generateToken(user.id, user.username, user.role, user.warehouseId ?? null);

    return {
      token,
      user: this.mapUser(user),
    };
  }

  // ──────────────────────────────────────────────────────────────
  // ĐĂNG NHẬP (username hoặc email)
  // ──────────────────────────────────────────────────────────────
  async login(dto: LoginDto) {
    // FE gửi `username` — cho phép đăng nhập bằng username hoặc email
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: dto.username }, { email: dto.username }],
      },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        fullName: true,
        email: true,
        phone: true,
        address: true,
        gender: true,
        dateOfBirth: true,
        role: true,
        warehouseId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không đúng');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không đúng');
    }

    const token = this.generateToken(user.id, user.username, user.role, user.warehouseId ?? null);
    const { passwordHash: _, ...userWithoutPassword } = user;

    return {
      token,
      user: this.mapUser(userWithoutPassword),
    };
  }

  // ──────────────────────────────────────────────────────────────
  // LẤY PROFILE (GET /auth/me)
  // ──────────────────────────────────────────────────────────────
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        address: true,
        gender: true,
        dateOfBirth: true,
        role: true,
        warehouseId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    return this.mapUser(user);
  }

  // ──────────────────────────────────────────────────────────────
  // CẬP NHẬT PROFILE (PUT /auth/me)
  // FE gửi snake_case: full_name, date_of_birth, ...
  // ──────────────────────────────────────────────────────────────
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.full_name !== undefined && { fullName: dto.full_name }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.gender !== undefined && { gender: dto.gender as any }),
        ...(dto.date_of_birth !== undefined && {
          dateOfBirth: dto.date_of_birth ? new Date(dto.date_of_birth) : null,
        }),
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        address: true,
        gender: true,
        dateOfBirth: true,
        role: true,
        warehouseId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return this.mapUser(user);
  }

  // ──────────────────────────────────────────────────────────────
  // ĐỔI MẬT KHẨU (PUT /auth/change-password)
  // FE gửi: { current_password, new_password }
  // ──────────────────────────────────────────────────────────────
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) throw new UnauthorizedException('Mật khẩu cũ không đúng');

    const newHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    return { message: 'Đổi mật khẩu thành công' };
  }

  // ──────────────────────────────────────────────────────────────
  // QUÊN MẬT KHẨU — Bước 1: Gửi OTP qua email
  // POST /api/auth/forgot-password  { phone }
  // ──────────────────────────────────────────────────────────────
  async forgotPassword(phone: string) {
    const user = await this.prisma.user.findFirst({
      where:  { phone },
      select: { id: true, username: true, fullName: true, email: true, phone: true },
    })
    if (!user) throw new NotFoundException('Không tìm thấy tài khoản với số điện thoại này')

    // Sinh OTP 6 chữ số
    const otp = String(Math.floor(100_000 + Math.random() * 900_000))

    // Lưu vào Map với TTL 5 phút
    OTP_STORE.set(phone, { otp, username: user.username, expiresAt: Date.now() + OTP_TTL_MS })

    // Gửi email với OTP (gọi sendOtpEmail)
    await this.emailService.sendOtpEmail({
      to:       user.email,
      fullName: user.fullName,
      otp,
      username: user.username,
    })

    // Mask thông tin trả về FE (không lộ OTP hay email đầy đủ)
    const maskedEmail = this.maskEmail(user.email)
    const maskedPhone = phone.slice(0, 4) + '***' + phone.slice(-3)

    return {
      success:      true,
      username:     user.username,
      maskedEmail,
      maskedPhone,
      message:      `Mã OTP đã gửi đến ${maskedEmail}. Có hiệu lực trong 5 phút.`,
    }
  }

  // ──────────────────────────────────────────────────────────────
  // QUÊN MẬT KHẨU — Bước 2: Xác minh OTP + Đặt mật khẩu mới
  // POST /api/auth/reset-password  { phone, otp, new_password }
  // ──────────────────────────────────────────────────────────────
  async resetPassword(phone: string, otp: string, newPassword: string) {
    const stored = OTP_STORE.get(phone)

    if (!stored) {
      throw new BadRequestException('Không tìm thấy yêu cầu đặt lại mật khẩu. Vui lòng thử lại.')
    }
    if (Date.now() > stored.expiresAt) {
      OTP_STORE.delete(phone)
      throw new BadRequestException('Mã OTP đã hết hạn (5 phút). Vui lòng yêu cầu mã mới.')
    }
    if (stored.otp !== otp) {
      throw new BadRequestException('Mã OTP không chính xác')
    }

    // OTP hợp lệ → cập nhật mật khẩu
    const newHash = await bcrypt.hash(newPassword, 10)
    const user = await this.prisma.user.update({
      where: { username: stored.username },
      data:  { passwordHash: newHash },
      select: { id: true, username: true, fullName: true, email: true, role: true, warehouseId: true },
    })

    // Xóa OTP sau khi dùng
    OTP_STORE.delete(phone)

    return { success: true, message: 'Đặt lại mật khẩu thành công! Bạn có thể đăng nhập.', username: user.username }
  }

  // ── Helper: mask email ─────────────────────────────────────────
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@')
    if (!local || !domain) return email
    const masked = local.length <= 3
      ? '*'.repeat(local.length)
      : local.slice(0, 2) + '*'.repeat(local.length - 3) + local.slice(-1)
    return `${masked}@${domain}`
  }
}
