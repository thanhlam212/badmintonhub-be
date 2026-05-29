import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateTransferDto, UpdateTransferStatusDto } from './dto/transfer.dto'

// Các chuyển trạng thái hợp lệ cho Transfer
const TRANSFER_TRANSITIONS: Record<string, string[]> = {
  pending:    ['approved', 'rejected'],
  approved:   ['in_transit', 'rejected'],
  in_transit: ['completed'],
  completed:  [],
  rejected:   [],
}

// Include clause dùng chung
const TRANSFER_INCLUDE = {
  fromWarehouse: { select: { name: true } },
  toWarehouse:   { select: { name: true } },
  creator:       { select: { fullName: true } },
  approver:      { select: { fullName: true } },
  items:         true,
} as const

@Injectable()
export class TransfersService {
  constructor(private prisma: PrismaService) {}

  // ─── GET /transfers ────────────────────────────────────────
  async getAll(user: any) {
    const transfers = await this.prisma.transferRequest.findMany({
      where: user.role === 'employee' && user.warehouseId
        ? { OR: [{ fromWarehouseId: user.warehouseId }, { toWarehouseId: user.warehouseId }] }
        : {},
      include: TRANSFER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })
    return transfers.map(this.mapTransfer)
  }

  // ─── GET /transfers/:id ────────────────────────────────────
  async getOne(id: string, user: any) {
    const t = await this.prisma.transferRequest.findUnique({
      where: { id },
      include: TRANSFER_INCLUDE,
    })
    if (!t) throw new NotFoundException('Không tìm thấy yêu cầu điều chuyển')

    // Employee chỉ xem transfer liên quan đến kho của mình
    if (user.role === 'employee' && user.warehouseId) {
      const involved = t.fromWarehouseId === user.warehouseId || t.toWarehouseId === user.warehouseId
      if (!involved) throw new NotFoundException('Không tìm thấy yêu cầu điều chuyển')
    }

    return this.mapTransfer(t)
  }

  // ─── POST /transfers ───────────────────────────────────────
  async create(dto: CreateTransferDto, user: any) {
    if (dto.from_warehouse_id === dto.to_warehouse_id) {
      throw new BadRequestException('Kho nguồn và kho đích không được trùng nhau')
    }

    // Verify cả 2 kho tồn tại
    const [fromWh, toWh] = await Promise.all([
      this.prisma.warehouse.findUnique({ where: { id: dto.from_warehouse_id } }),
      this.prisma.warehouse.findUnique({ where: { id: dto.to_warehouse_id } }),
    ])
    if (!fromWh) throw new NotFoundException(`Kho nguồn ID ${dto.from_warehouse_id} không tồn tại`)
    if (!toWh)   throw new NotFoundException(`Kho đích ID ${dto.to_warehouse_id} không tồn tại`)

    // Verify tất cả items tồn tại trong kho nguồn + lấy available
    const inventoryItems = await Promise.all(
      dto.items.map(item =>
        this.prisma.inventory.findUnique({
          where: { sku_warehouseId: { sku: item.sku, warehouseId: dto.from_warehouse_id } },
        })
      )
    )

    for (let i = 0; i < dto.items.length; i++) {
      const inv = inventoryItems[i]
      if (!inv) {
        throw new BadRequestException(`SKU "${dto.items[i].sku}" không tồn tại trong kho nguồn`)
      }
      if (inv.available < dto.items[i].quantity) {
        throw new BadRequestException(
          `SKU "${dto.items[i].sku}": tồn kho khả dụng ${inv.available}, cần ${dto.items[i].quantity}`
        )
      }
    }

    const transfer = await this.prisma.transferRequest.create({
      data: {
        date:           new Date(),
        fromWarehouseId: dto.from_warehouse_id,
        toWarehouseId:   dto.to_warehouse_id,
        reason:          dto.note || 'Điều chuyển kho',
        note:            dto.note ?? null,
        status:          'pending',
        pickupMethod:    'employee',
        createdBy:       user.id,
        items: {
          create: dto.items.map((item, idx) => ({
            sku:               item.sku,
            name:              inventoryItems[idx]!.name,
            qty:               item.quantity,
            availableAtRequest: inventoryItems[idx]!.available,
          })),
        },
      },
      include: { items: true },
    })

    return { success: true, data: { id: transfer.id } }
  }

  // ─── PATCH /transfers/:id/status ──────────────────────────
  async updateStatus(id: string, dto: UpdateTransferStatusDto, user: any) {
    const transfer = await this.prisma.transferRequest.findUnique({ where: { id } })
    if (!transfer) throw new NotFoundException('Không tìm thấy yêu cầu điều chuyển')

    const allowed = TRANSFER_TRANSITIONS[transfer.status] ?? []
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Không thể chuyển từ "${transfer.status}" sang "${dto.status}". ` +
        `Trạng thái hợp lệ: [${allowed.join(', ') || 'không có'}]`
      )
    }

    const updated = await this.prisma.transferRequest.update({
      where: { id },
      data: {
        status:      dto.status as any,
        approvedBy:  dto.status === 'approved' ? user.id : undefined,
        approvedAt:  dto.status === 'approved' ? new Date() : undefined,
        completedAt: dto.status === 'completed' ? new Date() : undefined,
      },
    })

    return { success: true, message: 'Cập nhật trạng thái thành công', status: updated.status }
  }

  // ─── Private mapper ────────────────────────────────────────
  private mapTransfer(t: any) {
    return {
      id:                t.id,
      date:              t.date,
      fromWarehouseId:   t.fromWarehouseId,
      fromWarehouseName: t.fromWarehouse.name,
      toWarehouseId:     t.toWarehouseId,
      toWarehouseName:   t.toWarehouse.name,
      reason:            t.reason,
      note:              t.note,
      status:            t.status,
      allowedNextStatuses: TRANSFER_TRANSITIONS[t.status] ?? [],
      pickupMethod:      t.pickupMethod,
      createdBy:         t.createdBy,
      createdByName:     t.creator.fullName,
      approvedBy:        t.approvedBy,
      approvedByName:    t.approver?.fullName ?? null,
      approvedAt:        t.approvedAt,
      completedAt:       t.completedAt,
      createdAt:         t.createdAt,
      items:             t.items,
    }
  }
}
