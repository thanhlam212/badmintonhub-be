import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateUserDto, UpdateUserDto, ResetPasswordDto } from './dto/user.dto'
import * as bcrypt from 'bcrypt'

const USER_SELECT = {
  id: true, username: true, fullName: true, email: true, phone: true,
  address: true, gender: true, dateOfBirth: true, role: true,
  warehouseId: true, createdAt: true, updatedAt: true,
} as const

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // ── Map Prisma User → snake_case (FE's transformUser() đọc) ──
  private mapUser(u: any) {
    return {
      id:            u.id,
      user_code:     '',
      username:      u.username,
      full_name:     u.fullName,
      email:         u.email,
      phone:         u.phone,
      address:       u.address ?? null,
      gender:        u.gender ?? null,
      date_of_birth: u.dateOfBirth ? new Date(u.dateOfBirth).toISOString().split('T')[0] : null,
      role:          u.role,
      warehouse_id:  u.warehouseId ?? null,
      created_at:    u.createdAt,
      updated_at:    u.updatedAt ?? u.createdAt,
    }
  }

  // ── GET /users ──────────────────────────────────────────────
  async findAll(filters: { role?: string; search?: string; page?: number; limit?: number }) {
    const { role, search, page = 1, limit = 20 } = filters
    const where: any = {}
    if (role) where.role = role
    if (search) {
      where.OR = [
        { username:  { contains: search, mode: 'insensitive' } },
        { fullName:  { contains: search, mode: 'insensitive' } },
        { email:     { contains: search, mode: 'insensitive' } },
        { phone:     { contains: search, mode: 'insensitive' } },
      ]
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select:  USER_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ])

    return {
      success: true,
      data: users.map(u => this.mapUser(u)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }
  }

  // ── GET /users/:id ──────────────────────────────────────────
  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT })
    if (!user) throw new NotFoundException('Không tìm thấy người dùng')
    return this.mapUser(user)
  }

  // ── POST /users ─────────────────────────────────────────────
  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: dto.email }, { phone: dto.phone }] },
    })
    if (existing) {
      if (existing.username === dto.username) throw new ConflictException('Username đã tồn tại')
      if (existing.email === dto.email)       throw new ConflictException('Email đã được đăng ký')
      if (existing.phone === dto.phone)       throw new ConflictException('Số điện thoại đã được đăng ký')
    }

    const passwordHash = await bcrypt.hash(dto.password, 10)
    const user = await this.prisma.user.create({
      data: {
        username:    dto.username,
        passwordHash,
        fullName:    dto.full_name,
        email:       dto.email,
        phone:       dto.phone,
        address:     dto.address,
        gender:      dto.gender as any,
        dateOfBirth: dto.date_of_birth ? new Date(dto.date_of_birth) : undefined,
        role:        dto.role as any ?? 'user',
        warehouseId: dto.warehouse_id ?? null,
      },
      select: USER_SELECT,
    })

    return this.mapUser(user)
  }

  // ── PUT /users/:id ──────────────────────────────────────────
  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id)
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.full_name    !== undefined && { fullName:    dto.full_name }),
        ...(dto.email        !== undefined && { email:       dto.email }),
        ...(dto.phone        !== undefined && { phone:       dto.phone }),
        ...(dto.address      !== undefined && { address:     dto.address }),
        ...(dto.gender       !== undefined && { gender:      dto.gender as any }),
        ...(dto.role         !== undefined && { role:        dto.role as any }),
        ...(dto.date_of_birth !== undefined && {
          dateOfBirth: dto.date_of_birth ? new Date(dto.date_of_birth) : null,
        }),
        ...(dto.warehouse_id !== undefined && { warehouseId: dto.warehouse_id ?? null }),
      },
      select: USER_SELECT,
    })
    return this.mapUser(user)
  }

  // ── PUT /users/:id/password ─────────────────────────────────
  async resetPassword(id: string, dto: ResetPasswordDto) {
    await this.findOne(id)
    const passwordHash = await bcrypt.hash(dto.new_password, 10)
    await this.prisma.user.update({ where: { id }, data: { passwordHash } })
    return { message: 'Đổi mật khẩu thành công' }
  }

  // ── DELETE /users/:id ───────────────────────────────────────
  async remove(id: string) {
    await this.findOne(id)
    await this.prisma.user.delete({ where: { id } })
    return { message: 'Đã xóa người dùng' }
  }
}
