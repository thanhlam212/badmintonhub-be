import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  // GET /branches — Lấy tất cả chi nhánh
  async findAll() {
    return this.prisma.branch.findMany({
      where: { isActive: true },
      include: {
        _count: {
          select: { courts: true }, // Đếm số sân mỗi chi nhánh
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  // GET /branches/:id — Chi tiết 1 chi nhánh + danh sách sân
  async findOne(id: number) {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      include: {
        courts: {
          where: { available: true },
          include: { amenities: true },
          orderBy: { type: 'asc' },
        },
        warehouses: {
          select: { id: true, name: true, isHub: true },
        },
        _count: {
          select: { courts: true },
        },
      },
    });

    if (!branch) throw new NotFoundException(`Chi nhánh #${id} không tồn tại`);
    return branch;
  }

  // POST /branches — Tạo chi nhánh mới (Admin)
  async create(dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: dto });
  }

  // PUT /branches/:id — Cập nhật chi nhánh (Admin)
  async update(id: number, dto: UpdateBranchDto) {
    await this.findOne(id);
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  // PATCH /branches/:id/toggle — Ẩn/Hiện chi nhánh (Admin)
  async toggle(id: number) {
    const branch = await this.findOne(id);
    return this.prisma.branch.update({
      where: { id },
      data: { isActive: !branch.isActive },
    });
  }
}