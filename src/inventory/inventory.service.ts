import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateAdminSlipDto, ImportStockDto, ExportStockDto } from './dto/inventory.dto'

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

  async getAdminSlips(user: any, filters?: {
    status?: string; type?: string; warehouseId?: number
  }) {
    await this.backfillMissingShippingPoImportSlips(user, filters?.warehouseId)

    const where: any = {}

    if (filters?.status && filters.status !== 'all') where.status = filters.status
    if (filters?.type && filters.type !== 'all') where.type = filters.type

    if (user.role === 'employee' && user.warehouseId) {
      where.warehouseId = user.warehouseId
    } else if (filters?.warehouseId) {
      where.warehouseId = filters.warehouseId
    }

    const slips = await this.prisma.adminWarehouseSlip.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        creator: { select: { fullName: true } },
        assignee: { select: { fullName: true } },
        processor: { select: { fullName: true } },
        purchaseOrder: { select: { id: true, status: true, createdAt: true } },
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return slips.map(this.mapAdminSlip)
  }

  private async backfillMissingShippingPoImportSlips(user: any, requestedWarehouseId?: number) {
    const warehouseId = user.role === 'employee' && user.warehouseId
      ? user.warehouseId
      : requestedWarehouseId

    const where: any = { status: 'shipping' }
    if (warehouseId) where.warehouseId = warehouseId

    const shippingPOs = await this.prisma.purchaseOrder.findMany({
      where,
      include: {
        items: true,
        slips: { where: { type: 'import' }, select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    for (const po of shippingPOs) {
      if (po.slips.length > 0) continue

      const assignedTo = await this.resolveSlipAssignee(po.warehouseId, undefined, po.createdBy)
      await this.prisma.adminWarehouseSlip.create({
        data: {
          type: 'import',
          poId: po.id,
          supplierId: po.supplierId,
          warehouseId: po.warehouseId,
          note: `Nhap kho theo PO ${po.id} (tu dong tao bo sung)`,
          status: 'pending',
          createdBy: po.createdBy,
          assignedTo,
          items: {
            create: po.items.map(item => ({
              sku: item.sku,
              name: item.name,
              qty: item.qty,
              unitCost: item.unitCost,
            })),
          },
        },
      })
    }
  }

  async createAdminSlip(dto: CreateAdminSlipDto, user: any) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId } })
    if (!warehouse) throw new NotFoundException(`Kho ID ${dto.warehouseId} khong ton tai`)

    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } })
      if (!supplier) throw new NotFoundException(`Nha cung cap ID ${dto.supplierId} khong ton tai`)
    }

    const assignedTo = await this.resolveSlipAssignee(dto.warehouseId, dto.assignedTo, user.id)
    const poId = dto.poId && /^[0-9a-fA-F-]{36}$/.test(dto.poId) ? dto.poId : undefined

    const slip = await this.prisma.adminWarehouseSlip.create({
      data: {
        type: dto.type,
        poId,
        supplierId: dto.supplierId ?? null,
        warehouseId: dto.warehouseId,
        note: dto.note ?? null,
        status: 'pending',
        createdBy: user.id,
        assignedTo,
        items: {
          create: dto.items.map(item => ({
            sku: item.sku,
            name: item.name || item.sku,
            qty: item.qty,
            unitCost: item.unitCost,
          })),
        },
      },
      include: {
        warehouse: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        creator: { select: { fullName: true } },
        assignee: { select: { fullName: true } },
        processor: { select: { fullName: true } },
        purchaseOrder: { select: { id: true, status: true, createdAt: true } },
        items: true,
      },
    })

    return this.mapAdminSlip(slip)
  }

  async processAdminSlip(id: string, user: any) {
    const slip = await this.prisma.adminWarehouseSlip.findUnique({
      where: { id },
      select: { id: true, status: true, warehouseId: true },
    })
    if (!slip) throw new NotFoundException('Khong tim thay phieu kho')
    if (user.role === 'employee' && user.warehouseId && slip.warehouseId !== user.warehouseId) {
      throw new NotFoundException('Khong tim thay phieu kho')
    }
    if (slip.status === 'processed') return { success: true, message: 'Phieu da duoc xu ly' }

    await this.prisma.adminWarehouseSlip.update({
      where: { id },
      data: { status: 'processed', processedAt: new Date(), processedBy: user.id },
    })

    return { success: true, message: 'Da cap nhat trang thai phieu kho' }
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
  private async resolveSlipAssignee(warehouseId: number, requestedUserId?: string, fallbackUserId?: string) {
    if (requestedUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: requestedUserId },
        select: { id: true },
      })
      if (user) return user.id
    }

    const warehouseUser = await this.prisma.user.findFirst({
      where: { role: 'employee', warehouseId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })

    return warehouseUser?.id || fallbackUserId!
  }

  private mapAdminSlip(slip: any) {
    return {
      id: slip.id,
      type: slip.type,
      source: 'admin',
      poId: slip.poId ?? undefined,
      poRawId: slip.poId ?? undefined,
      poCreatedAt: slip.purchaseOrder?.createdAt ?? undefined,
      supplierId: slip.supplierId ?? undefined,
      supplier: slip.supplier?.name,
      date: slip.createdAt ? new Date(slip.createdAt).toISOString().split('T')[0] : '',
      warehouseId: slip.warehouseId,
      warehouse: slip.warehouse?.name || '',
      items: (slip.items || []).map((item: any) => ({
        sku: item.sku,
        name: item.name,
        qty: item.qty,
        unitCost: Number(item.unitCost ?? 0),
      })),
      note: slip.note || '',
      status: slip.status,
      createdBy: slip.creator?.fullName || slip.createdBy,
      assignedTo: slip.assignee?.fullName || slip.assignedTo,
      processedAt: slip.processedAt,
      processedBy: slip.processor?.fullName || slip.processedBy,
      purchaseOrderStatus: slip.purchaseOrder?.status,
    }
  }
}
