import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreatePurchaseOrderDto, UpdatePOStatusDto } from './dto/purchase-order.dto'

// State machine cho Purchase Order
const PO_TRANSITIONS: Record<string, string[]> = {
  draft:     ['sent', 'cancelled'],
  sent:      ['confirmed', 'cancelled'],
  confirmed: ['shipping', 'cancelled'],
  shipping:  ['received'],
  received:  [],
  cancelled: [],
}

// Include clause dùng chung
const PO_INCLUDE = {
  supplier:  { select: { name: true } },
  warehouse: { select: { name: true } },
  creator:   { select: { fullName: true } },
  items:     true,
} as const

@Injectable()
export class PurchaseOrdersService {
  constructor(private prisma: PrismaService) {}

  // ─── GET /purchase-orders/suppliers ───────────────────────
  async getSuppliers() {
    return this.prisma.supplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true, contactPerson: true, phone: true, email: true },
      orderBy: { name: 'asc' },
    })
  }

  // ─── GET /purchase-orders ──────────────────────────────────
  async getAll(user: any) {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: user.role === 'employee' && user.warehouseId
        ? { warehouseId: user.warehouseId }
        : {},
      include: PO_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })
    return orders.map(this.mapPO)
  }

  // ─── GET /purchase-orders/:id ──────────────────────────────
  async getOne(id: string, user: any) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: PO_INCLUDE,
    })
    if (!po) throw new NotFoundException('Không tìm thấy đơn đặt hàng')

    // Employee chỉ xem đơn thuộc kho của mình
    if (user.role === 'employee' && user.warehouseId && po.warehouseId !== user.warehouseId) {
      throw new NotFoundException('Không tìm thấy đơn đặt hàng')
    }

    return this.mapPO(po)
  }

  // ─── POST /purchase-orders ─────────────────────────────────
  // FE gửi: { supplier_id, warehouse_id, note?, items: [{ sku, quantity, price }] }
  async create(dto: CreatePurchaseOrderDto, user: any) {
    // Verify supplier + warehouse tồn tại
    const [supplier, warehouse] = await Promise.all([
      this.prisma.supplier.findUnique({ where: { id: dto.supplier_id } }),
      this.prisma.warehouse.findUnique({ where: { id: dto.warehouse_id } }),
    ])
    if (!supplier)  throw new NotFoundException(`Nhà cung cấp ID ${dto.supplier_id} không tồn tại`)
    if (!warehouse) throw new NotFoundException(`Kho ID ${dto.warehouse_id} không tồn tại`)

    // Tra cứu tên sản phẩm từ bảng products (để lưu vào PO item)
    const products = await Promise.all(
      dto.items.map(item =>
        this.prisma.product.findFirst({
          where: { sku: item.sku },
          select: { name: true },
        })
      )
    )

    const totalValue = dto.items.reduce((sum, i) => sum + i.quantity * i.price, 0)

    const po = await this.prisma.purchaseOrder.create({
      data: {
        supplierId:  dto.supplier_id,
        warehouseId: dto.warehouse_id,
        status:      'draft',
        totalValue,
        note:        dto.note ?? null,
        createdBy:   user.id,
        items: {
          create: dto.items.map((i, idx) => ({
            sku:      i.sku,
            name:     products[idx]?.name || i.sku,   // fallback về SKU nếu không tìm thấy tên
            qty:      i.quantity,
            unitCost: i.price,
          })),
        },
      },
      include: { items: true },
    })

    return { success: true, data: { id: po.id } }
  }

  // ─── PATCH /purchase-orders/:id/status ────────────────────
  async updateStatus(id: string, dto: UpdatePOStatusDto, user?: any) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true, warehouse: true },
    })
    if (!po) throw new NotFoundException('Không tìm thấy đơn đặt hàng')

    const allowed = PO_TRANSITIONS[po.status] ?? []
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Không thể chuyển từ "${po.status}" sang "${dto.status}". ` +
        `Trạng thái hợp lệ: [${allowed.join(', ') || 'không có'}]`
      )
    }

    // ── Nhận hàng: nhập vào tồn kho ───────────────────────────
    if (dto.status === 'received') {
      await this.prisma.$transaction(async (tx) => {
        const now     = new Date()
        const shortId = id.slice(0, 8).toUpperCase()
        const statusUpdate = await tx.purchaseOrder.updateMany({
          where: { id, status: 'shipping' },
          data:  { status: 'received' },
        })
        if (statusUpdate.count === 0) {
          throw new BadRequestException('PO da duoc nhan hoac khong con o trang thai van chuyen')
        }

        for (const item of po.items) {
          // Tra cứu thông tin sản phẩm để lấy category và productId
          const product = await tx.product.findFirst({
            where: { sku: item.sku },
            select: { id: true, category: true, image: true },
          })

          // Upsert inventory: tạo mới nếu SKU chưa có trong kho
          await tx.inventory.upsert({
            where: { sku_warehouseId: { sku: item.sku, warehouseId: po.warehouseId } },
            create: {
              sku:         item.sku,
              warehouseId: po.warehouseId,
              productId:   product?.id   ?? null,
              name:        item.name,
              category:    product?.category ?? 'Khác',
              onHand:      item.qty,
              available:   item.qty,
              unitCost:    item.unitCost,
              image:       product?.image ?? null,
            },
            update: {
              onHand:    { increment: item.qty },
              available: { increment: item.qty },
              unitCost:  item.unitCost, // cập nhật giá nhập mới nhất
            },
          })

          // Tạo phiếu giao dịch nhập kho
          await tx.inventoryTransaction.create({
            data: {
              type:        'import',
              date:        now,
              sku:         item.sku,
              warehouseId: po.warehouseId,
              qty:         item.qty,
              cost:        Number(item.unitCost),
              note:        `Nhập theo PO [${shortId}] từ NCC`,
              operatorId:  user.id,
            },
          })

          await this.prisma.syncProductInStock(tx, item.sku)
        }
      })

      return { success: true, message: 'Đã nhận hàng và cập nhật tồn kho thành công' }
    }

    // ── Các trạng thái khác ────────────────────────────────────
    await this.prisma.purchaseOrder.update({
      where: { id },
      data:  { status: dto.status as any },
    })

    return { success: true, message: 'Cập nhật trạng thái thành công' }
  }

  // ─── Private mapper ────────────────────────────────────────
  private mapPO(po: any) {
    return {
      id:            po.id,
      status:        po.status,
      totalValue:    Number(po.totalValue),
      note:          po.note,
      createdAt:     po.createdAt,
      updatedAt:     po.updatedAt,
      supplierId:    po.supplierId,
      supplierName:  po.supplier.name,
      warehouseId:   po.warehouseId,
      warehouseName: po.warehouse.name,
      createdBy:     po.createdBy,
      createdByName: po.creator.fullName,
      allowedNextStatuses: PO_TRANSITIONS[po.status] ?? [],
      items: po.items.map((i: any) => ({
        id:       i.id,
        sku:      i.sku,
        name:     i.name,
        qty:      i.qty,
        unitCost: Number(i.unitCost),
        total:    Number(i.unitCost) * i.qty,
      })),
    }
  }
}
