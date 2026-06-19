import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ImportStockDto, ExportStockDto } from './dto/inventory.dto'

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  // ─── GET /inventory/warehouses ─────────────────────────────
  async getWarehouses() {
    return this.prisma.warehouse.findMany({
      where: { isActive: true },
      select: { id: true, name: true, branchId: true },
      orderBy: { id: 'asc' },
    })
  }

  // ─── GET /inventory/warehouse/:id ──────────────────────────
  async getByWarehouse(warehouseId: number) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: warehouseId } })
    if (!warehouse) throw new NotFoundException(`Kho ID ${warehouseId} không tồn tại`)

    const items = await this.prisma.inventory.findMany({
      where: { warehouseId },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
    return items.map(i => ({ ...i, unitCost: Number(i.unitCost) }))
  }

  // ─── GET /inventory ────────────────────────────────────────
  async getAll(user: any, filters?: {
    warehouseId?: number; category?: string; search?: string; lowStock?: boolean
  }) {
    const where: any = {}

    // Filter theo warehouseId nếu có query param
    // (Bỏ filter role-based, cho nhân viên xem được tất cả kho — FE tự chọn kho mặc định)
    if (filters?.warehouseId) {
      where.warehouseId = filters.warehouseId
    }

    if (filters?.category) where.category = filters.category
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { sku:  { contains: filters.search, mode: 'insensitive' } },
      ]
    }

    const items = await this.prisma.inventory.findMany({
      where,
      include: { warehouse: { select: { id: true, name: true } } },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })

    const mapped = items.map((i: any) => ({
      ...i,
      unitCost:      Number(i.unitCost),
      warehouseName: i.warehouse.name,
    }))

    if (filters?.lowStock) {
      return mapped.filter((i: any) => (i.available ?? i.onHand ?? 0) <= (i.reorderPoint ?? 0))
    }

    return mapped
  }

  // ─── GET /inventory/low-stock ──────────────────────────────
  // available <= reorderPoint: cần column comparison → giữ $queryRaw (safe vì warehouseId là số)
  async getLowStock(user: any) {
    const isEmployee = user.role === 'employee' && user.warehouseId

    const rows = isEmployee
      ? await this.prisma.$queryRaw<any[]>`
          SELECT i.*, w.name AS warehouse_name
          FROM inventory i
          JOIN warehouses w ON w.id = i.warehouse_id
          WHERE i.available <= i.reorder_point
            AND i.warehouse_id = ${user.warehouseId}
          ORDER BY i.available ASC`
      : await this.prisma.$queryRaw<any[]>`
          SELECT i.*, w.name AS warehouse_name
          FROM inventory i
          JOIN warehouses w ON w.id = i.warehouse_id
          WHERE i.available <= i.reorder_point
          ORDER BY i.available ASC`

    return rows.map(r => ({ ...r, unit_cost: Number(r.unit_cost) }))
  }

  // ─── GET /inventory/transactions ──────────────────────────
  async getTransactions(user: any) {
    const txns = await this.prisma.inventoryTransaction.findMany({
      where: user.role === 'employee' && user.warehouseId
        ? { warehouseId: user.warehouseId }
        : {},
      include: { warehouse: { select: { name: true } } },
      orderBy: { date: 'desc' },
      take: 200,
    })
    return txns.map(t => ({
      ...t,
      cost:          Number(t.cost),
      warehouseName: t.warehouse.name,
    }))
  }

  // ─── POST /inventory/import ────────────────────────────────
  // FE gửi: { sku, warehouseId, qty, cost?, note? }
  async importStock(dto: ImportStockDto, user: any) {
    const item = await this.prisma.inventory.findUnique({
      where: { sku_warehouseId: { sku: dto.sku, warehouseId: dto.warehouseId } },
    })
    const cost = dto.cost ?? item?.unitCost ?? 0

    await this.prisma.$transaction(async (tx) => {
      if (item) {
        await tx.inventory.update({
          where: { sku_warehouseId: { sku: dto.sku, warehouseId: dto.warehouseId } },
          data: {
            onHand:    { increment: dto.qty },
            available: { increment: dto.qty },
            ...(dto.cost !== undefined && { unitCost: dto.cost }),
          },
        })
      } else {
        const product = await tx.product.findUnique({
          where: { sku: dto.sku },
          select: { id: true, name: true, category: true, image: true },
        })
        if (!product) {
          throw new BadRequestException(`SKU "${dto.sku}" không tồn tại trong danh mục sản phẩm`)
        }
        await tx.inventory.create({
          data: {
            sku: dto.sku,
            productId: product.id,
            warehouseId: dto.warehouseId,
            name: product.name,
            category: product.category,
            onHand: dto.qty,
            reserved: 0,
            available: dto.qty,
            reorderPoint: 10,
            unitCost: cost,
            image: product.image ?? null,
          },
        })
      }

      await tx.inventoryTransaction.create({
        data: {
          type:        'import',
          date:        new Date(),
          sku:         dto.sku,
          warehouseId: dto.warehouseId,
          qty:         dto.qty,
          cost,
          note:        dto.note ?? null,
          operatorId:  user.id ?? null,
        },
      })
      await this.prisma.syncProductInStock(tx, dto.sku)
    })

    return { success: true, message: 'Nhập kho thành công' }
  }

  // ─── POST /inventory/export ────────────────────────────────
  // FE gửi: { sku, warehouseId, qty, note? }
  async exportStock(dto: ExportStockDto, user: any) {
    const item = await this.prisma.inventory.findUnique({
      where: { sku_warehouseId: { sku: dto.sku, warehouseId: dto.warehouseId } },
    })
    if (!item) {
      throw new BadRequestException(`SKU "${dto.sku}" không tồn tại trong kho ID ${dto.warehouseId}`)
    }
    if (item.available < dto.qty) {
      throw new BadRequestException(`Không đủ hàng: còn ${item.available}, cần ${dto.qty}`)
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.inventory.update({
        where: { sku_warehouseId: { sku: dto.sku, warehouseId: dto.warehouseId } },
        data: {
          onHand:    { decrement: dto.qty },
          available: { decrement: dto.qty },
        },
      })
      await tx.inventoryTransaction.create({
        data: {
          type:        'export',
          date:        new Date(),
          sku:         dto.sku,
          warehouseId: dto.warehouseId,
          qty:         dto.qty,
          cost:        item.unitCost,
          note:        dto.note ?? null,
          operatorId:  user.id ?? null,
        },
      })
      await this.prisma.syncProductInStock(tx, dto.sku)
    })

    return { success: true, message: 'Xuất kho thành công' }
  }
}
