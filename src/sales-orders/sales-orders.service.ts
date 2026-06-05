import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { EmailService }   from '../email/email.service'
import {
  CreateSalesOrderDto, UpdateSalesOrderStatusDto, CreateWalkInAccountDto,
} from './dto/sales-order.dto'
import * as bcrypt from 'bcrypt'

// ─── Map helpers ────────────────────────────────────────────────

function mapSalesOrder(o: any) {
  return {
    id:             o.id,
    branch_id:      o.branchId ?? null,
    branch_name:    o.branch?.name ?? null,
    customer_name:  o.customerName,
    customer_phone: o.customerPhone ?? null,
    total:          parseFloat(String(o.total ?? 0)),
    discount:       parseFloat(String(o.discount ?? 0)),
    final_total:    parseFloat(String(o.finalTotal ?? 0)),
    payment_method: o.paymentMethod ?? null,
    note:           o.note ?? null,
    status:         o.status,
    reject_reason:  o.rejectReason ?? null,
    approved_by:    o.approvedBy ?? null,
    approved_at:    o.approvedAt ?? null,
    created_at:     o.createdAt,
    created_by:     o.createdBy,
    creator_name:   o.creator?.fullName ?? null,
    items: (o.items || []).map((item: any) => ({
      id:           item.id,
      product_id:   item.productId,
      product_name: item.productName,
      price:        parseFloat(String(item.price ?? 0)),
      qty:          item.qty,
    })),
  }
}

function mapCustomer(u: any) {
  return {
    id:        u.id || null,
    user_code: '',
    username:  u.username || '',
    full_name: u.fullName || u.full_name || '',
    email:     u.email || '',
    phone:     u.phone || '',
    role:      u.role || 'user',
  }
}

const INCLUDE_FULL = {
  branch:  { select: { id: true, name: true } },
  creator: { select: { id: true, fullName: true, username: true } },
  approver: { select: { id: true, fullName: true } },
  items: {
    include: { product: { select: { id: true, name: true, sku: true } } },
  },
} as const

@Injectable()
export class SalesOrdersService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  // ── GET /sales-orders ──────────────────────────────────────────
  async findAll(filters: { status?: string; branchId?: number }) {
    const where: any = {}
    if (filters.status) where.status = filters.status
    if (filters.branchId) where.branchId = filters.branchId

    const orders = await this.prisma.salesOrder.findMany({
      where,
      include: INCLUDE_FULL,
      orderBy: { createdAt: 'desc' },
    })
    return { success: true, data: orders.map(mapSalesOrder) }
  }

  // ── GET /sales-orders/:id ──────────────────────────────────────
  async findOne(id: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: INCLUDE_FULL,
    })
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng')
    return { success: true, data: mapSalesOrder(order) }
  }

  // ── GET /sales-orders/customers ────────────────────────────────
  async searchCustomers(search: string) {
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { username:  { contains: search, mode: 'insensitive' } },
          { fullName:  { contains: search, mode: 'insensitive' } },
          { phone:     { contains: search, mode: 'insensitive' } },
          { email:     { contains: search, mode: 'insensitive' } },
        ],
      },
      select: { id: true, username: true, fullName: true, email: true, phone: true, role: true },
      take: 20,
    })
    return { success: true, data: users.map(mapCustomer) }
  }

  // ── POST /sales-orders/customers/walk-in-account ───────────────
  async createWalkInAccount(dto: CreateWalkInAccountDto) {
    // Kiểm tra xem số điện thoại đã tồn tại chưa
    const existing = await this.prisma.user.findFirst({
      where: { phone: dto.phone },
      select: { id: true, username: true, fullName: true, email: true, phone: true, role: true },
    })

    if (existing) {
      return {
        success: true,
        data: {
          user:        mapCustomer(existing),
          credentials: null,
          existed:     true,
        },
      }
    }

    if (!dto.create_account) {
      // Trả về khách lẻ chưa có tài khoản (không tạo)
      return {
        success: true,
        data: {
          user: mapCustomer({
            id: null, username: '', fullName: dto.full_name,
            email: '', phone: dto.phone, role: 'guest',
          }),
          credentials: null,
          existed: false,
        },
      }
    }

    // Tạo tài khoản walk-in mới
    const username = `walkin_${dto.phone}`
    const rawPassword = dto.phone.slice(-6)
    const passwordHash = await bcrypt.hash(rawPassword, 10)

    const user = await this.prisma.user.create({
      data: {
        username,
        passwordHash,
        fullName: dto.full_name,
        email:    `${dto.phone}@walkin.local`,
        phone:    dto.phone,
        role:     'user' as any,
      },
      select: { id: true, username: true, fullName: true, email: true, phone: true, role: true },
    })

    return {
      success: true,
      data: {
        user:        mapCustomer(user),
        credentials: { username, password: rawPassword },
        existed:     false,
      },
    }
  }

  // ── POST /sales-orders ─────────────────────────────────────────
  async create(dto: CreateSalesOrderDto, createdBy: string) {
    const total      = dto.total      ?? dto.items.reduce((s, i) => s + i.price * i.qty, 0)
    const discount   = dto.discount   ?? 0
    const finalTotal = dto.final_total ?? (total - discount)

    let branchId = dto.branch_id ?? null
    if (dto.fulfill_warehouse_id) {
      const fulfillWarehouse = await this.prisma.warehouse.findUnique({
        where: { id: dto.fulfill_warehouse_id },
        select: { branchId: true },
      })
      if (!fulfillWarehouse) {
        throw new BadRequestException('Kho xuat hang khong ton tai')
      }
      if (fulfillWarehouse.branchId) {
        branchId = fulfillWarehouse.branchId
      }
    }
    if (!branchId || branchId <= 0) {
      const creator = await this.prisma.user.findUnique({
        where: { id: createdBy },
        include: { warehouse: true }
      })
      if (creator?.warehouse?.branchId) {
        branchId = creator.warehouse.branchId
      }
    }

    // Xử lý items: nếu product_id null, tìm theo tên
    const resolvedItems: Array<{ productId: number; productName: string; price: number; qty: number }> = []
    for (const item of dto.items) {
      let productId = item.product_id && item.product_id > 0 ? item.product_id : null

      if (!productId) {
        // Tìm sản phẩm theo tên
        const found = await this.prisma.product.findFirst({
          where: { name: { contains: item.product_name, mode: 'insensitive' } },
          select: { id: true },
        })
        if (!found) {
          throw new BadRequestException(
            `Không tìm thấy sản phẩm "${item.product_name}". Vui lòng chọn từ danh mục sản phẩm.`,
          )
        }
        productId = found.id
      }

      resolvedItems.push({
        productId,
        productName: item.product_name,
        price: item.price,
        qty:   item.qty,
      })
    }

    const order = await this.prisma.salesOrder.create({
      data: {
        createdBy,
        branchId,
        customerName:  dto.customer_name  ?? 'Khách lẻ',
        customerPhone: dto.customer_phone ?? null,
        total,
        discount,
        finalTotal,
        paymentMethod: dto.payment_method ?? 'cash',
        note:          dto.note ?? null,
        status:        'pending' as any,
        items: {
          create: resolvedItems.map(i => ({
            productId:   i.productId,
            productName: i.productName,
            price:       i.price,
            qty:         i.qty,
          })),
        },
      },
      include: INCLUDE_FULL,
    })

    return { success: true, data: mapSalesOrder(order) }
  }

  // ── PATCH /sales-orders/:id/approve ───────────────────────────
  async approve(id: string, payload: UpdateSalesOrderStatusDto, approvedBy: string) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } })
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng')
    if (order.status !== 'pending') {
      throw new BadRequestException(`Đơn hàng đang ở trạng thái ${order.status}, không thể duyệt`)
    }
    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        status:     'approved' as any,
        approvedBy,
        approvedAt: new Date(),
        ...(payload.payment_method && { paymentMethod: payload.payment_method }),
        ...(payload.note && { note: payload.note }),
      },
      include: INCLUDE_FULL,
    })
    return { success: true, data: mapSalesOrder(updated) }
  }

  // ── PATCH /sales-orders/:id/reject ────────────────────────────
  async reject(id: string, payload: UpdateSalesOrderStatusDto) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } })
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng')
    if (order.status !== 'pending') {
      throw new BadRequestException(`Không thể từ chối đơn hàng đang ở trạng thái ${order.status}`)
    }
    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        status:       'rejected' as any,
        rejectReason: payload.reject_reason ?? 'Không được duyệt',
      },
      include: INCLUDE_FULL,
    })
    return { success: true, data: mapSalesOrder(updated) }
  }

  // ── PATCH /sales-orders/:id/confirm-payment ───────────────────
  async confirmPayment(id: string, payload: UpdateSalesOrderStatusDto, userId: string) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } })
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng')
    // Cho phép xác nhận từ pending hoặc approved
    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        status:     'approved' as any,
        approvedBy: userId,
        approvedAt: new Date(),
        ...(payload.payment_method && { paymentMethod: payload.payment_method }),
        ...(payload.note && { note: payload.note }),
      },
      include: INCLUDE_FULL,
    })
    return { success: true, data: mapSalesOrder(updated) }
  }

  // ── PATCH /sales-orders/:id/complete ──────────────────────────
<<<<<<< HEAD
  async complete(id: string, user: any) {
    // Load đủ thông tin: items (kèm SKU), branch (kèm warehouse)
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: {
        items: { include: { product: { select: { id: true, sku: true } } } },
        branch: {
          select: {
            id: true, name: true,
            warehouses: {
              where: { isActive: true },
              select: { id: true, name: true },
              take: 1,
            },
          },
        },
        creator:  { select: { id: true, fullName: true } },
        approver: { select: { id: true, fullName: true } },
      },
=======
  async complete(id: string, user?: any) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: { items: { include: { product: true } } }
>>>>>>> a207e7f05af68b61a5b4e549e4878089e1c55522
    })
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng')
    if (order.status !== 'approved') {
      throw new BadRequestException('Chỉ có thể hoàn thành đơn hàng đã được duyệt')
    }

<<<<<<< HEAD
    const warehouse = (order as any).branch?.warehouses?.[0] ?? null
    const now       = new Date()
    const shortId   = id.slice(0, 8).toUpperCase()

    await this.prisma.$transaction(async (tx) => {
      // ── Xuất kho nếu có warehouse liên kết ──────────────────
      if (warehouse) {
        for (const item of order.items) {
          const sku = (item as any).product?.sku
          if (!sku) continue

          const inv = await tx.inventory.findUnique({
            where: { sku_warehouseId: { sku, warehouseId: warehouse.id } },
          })

          if (inv && inv.available >= item.qty) {
            await tx.inventory.update({
              where: { sku_warehouseId: { sku, warehouseId: warehouse.id } },
              data: {
                onHand:    { decrement: item.qty },
                available: { decrement: item.qty },
              },
            })
            await tx.inventoryTransaction.create({
              data: {
                type:        'export',
                date:        now,
                sku,
                warehouseId: warehouse.id,
                qty:         item.qty,
                cost:        Number(inv.unitCost),
                note:        `Bán hàng [${shortId}] – ${order.customerName}`,
                operatorId:  user.id,
              },
            })
          }
          // Nếu thiếu hàng: tiếp tục xử lý (không block), ghi log
        }
      }

      // ── Cập nhật trạng thái đơn ──────────────────────────────
      await tx.salesOrder.update({
        where: { id },
        data:  { status: 'exported' as any },
      })
    })

    // ── Gửi email xác nhận đơn hàng (fire-and-forget) ───────────
    const customerEmail = await this.findCustomerEmail(order.customerPhone)
    if (customerEmail) {
      this.emailService.sendOrderConfirmed({
        id,
        customerName:  order.customerName,
        customerEmail,
        items: order.items.map((i: any) => ({
          name:  i.productName,
          qty:   i.qty,
          price: Number(i.price),
        })),
        total:         Number(order.finalTotal),
        paymentMethod: order.paymentMethod,
      }).catch(() => {/* fire-and-forget */})
    }

    const updated = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: INCLUDE_FULL,
=======
    if (!order.branchId) {
      const operator = await this.prisma.user.findUnique({
        where: { id: user?.id || order.createdBy },
        include: { warehouse: true },
      })
      if (operator?.warehouse?.branchId) {
        order.branchId = operator.warehouse.branchId
      }
    }

    if (!order.branchId) {
      throw new BadRequestException('Đơn hàng không liên kết với chi nhánh nào')
    }

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { branchId: order.branchId, isActive: true }
>>>>>>> a207e7f05af68b61a5b4e549e4878089e1c55522
    })
    if (!warehouse) {
      throw new NotFoundException(`Không tìm thấy kho hoạt động cho chi nhánh này`)
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Check stock
      for (const item of order.items) {
        const sku = item.product.sku
        const inv = await tx.inventory.findUnique({
          where: { sku_warehouseId: { sku, warehouseId: warehouse.id } }
        })
        if (!inv || inv.available < item.qty) {
          throw new BadRequestException(
            `Kho ${warehouse.name} không đủ sản phẩm "${item.productName}": còn ${inv?.available ?? 0}, cần ${item.qty}`
          )
        }
      }

      // Deduct stock and log transaction
      for (const item of order.items) {
        const sku = item.product.sku
        const inv = await tx.inventory.findUnique({
          where: { sku_warehouseId: { sku, warehouseId: warehouse.id } }
        })

        await tx.inventory.update({
          where: { sku_warehouseId: { sku, warehouseId: warehouse.id } },
          data: {
            onHand:    { decrement: item.qty },
            available: { decrement: item.qty },
          },
        })

        await tx.inventoryTransaction.create({
          data: {
            type:        'export',
            date:        new Date(),
            sku,
            warehouseId: warehouse.id,
            qty:         item.qty,
            cost:        inv ? inv.unitCost : 0,
            note:        `Xuất bán offline tại cửa hàng (Đơn: ${id})`,
            operatorId:  order.createdBy || null,
          },
        })
      }

      return tx.salesOrder.update({
        where: { id },
        data: { status: 'exported' as any },
        include: INCLUDE_FULL,
      })
    })

    return { success: true, data: mapSalesOrder(updated) }
  }

  // ── Helper: tìm email khách hàng theo SĐT ──────────────────────
  private async findCustomerEmail(phone: string | null): Promise<string | null> {
    if (!phone) return null
    const user = await this.prisma.user.findFirst({
      where:  { phone },
      select: { email: true },
    })
    return user?.email ?? null
  }
}
