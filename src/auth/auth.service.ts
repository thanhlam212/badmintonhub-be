import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
    [x: string]: any;
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
    ) {}

    // Register a new user
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

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Tạo user
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
        gender: dto.gender as any,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        role: 'user', // Mặc định role = user
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
      },
    });
     // Trả về token luôn sau khi đăng ký
    const tokens = await this.generateTokens(user.id, user.username, user.role, null);

    return {
      message: 'Đăng ký thành công',
      user,
      ...tokens,
      };
    }

  // ──────────────────────────────────────────────
  // ĐĂNG NHẬP (username hoặc email)
  // ──────────────────────────────────────────────
  async login(dto: LoginDto) {
    // Tìm user theo username hoặc email
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: dto.identifier },
          { email: dto.identifier },
        ],
      },
      include: {
        warehouse: {
          select: { id: true, name: true, branchId: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không đúng');
    }

    // Kiểm tra password
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không đúng');
    }

    // Generate tokens
    const tokens = await this.generateTokens(
      user.id,
      user.username,
      user.role,
      user.warehouseId,
    );

    // Trả về thông tin user (bỏ passwordHash)
    const { passwordHash: _, ...userWithoutPassword } = user;

    return {
      message: 'Đăng nhập thành công',
      user: userWithoutPassword,
      ...tokens,
    };
  }
  // ──────────────────────────────────────────────
  // LẤY PROFILE (dùng req.user từ JwtStrategy)
  // ──────────────────────────────────────────────
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
        createdAt: true,
        warehouse: {
          select: { id: true, name: true, branchId: true },
        },
      },
    });

    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    return user;
  }
  // ──────────────────────────────────────────────
  // ĐỔI MẬT KHẨU
  // ──────────────────────────────────────────────
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    const isValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isValid) throw new UnauthorizedException('Mật khẩu cũ không đúng');

    const newHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    return { message: 'Đổi mật khẩu thành công' };
  }

  // ──────────────────────────────────────────────
  // HELPER: Tạo JWT token
  // ──────────────────────────────────────────────
  private async generateTokens(
    userId: string,
    username: string,
    role: string,
    warehouseId: number | null,
  ) {
    const payload = { sub: userId, username, role, warehouseId };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_EXPIRES_IN') || '7d',
    });

    return await { accessToken };
  }
}
