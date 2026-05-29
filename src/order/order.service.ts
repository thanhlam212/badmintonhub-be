import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateOrderDto } from './dto/order.dto'
import { invoiceCode } from '../bookings/booking.helpers'

// Các chuyển trạng thái hợp lệ cho Order
const ORDER_TRANSITIONS: Record<string, string[]> = {
  pending:    ['confirmed', 'cancelled'],
  confirmed:  ['processing', 'cancelled'],
  processing: ['shipping', 'cancelled'],
  shipping:   ['delivered'],
  delivered:  ['refunded'],
  cancelled:  [],
  refunded:   [],
}

// Khi Order đổi trạng thái → đồng bộ Invoice tương ứng
const ORDER_STATUS_TO_INVOICE: Record<string, string> = {
  cancelled: 'cancelled',
  delivered: 'paid',
  refunded:  'refunded',
}

@Injectable()
export class OrderService {
  constructor(private prisma: PrismaService) {}

  // ─── Tạo đơn hàng mới ─────────────────────────────────────
  async create(dto: CreateOrderDto, userId?: string) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Đơn hàng phải có ít nhất 1 sản phẩm')
    }

    const productIds = dto.items.map(i => i.product_id)
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
    })

    if (products.length !== productIds.length) {
      throw new BadRequestException('Một số sản phẩm không tồn tại')
    }

    return this.prisma.$transaction(async (tx) => {
      // FE gửi qty (không phải quantity), dùng giá từ DB (không tin giá FE gửi)
      const itemsWithPrice = dto.items.map(item => {
        const product = products.find(p => p.id === item.product_id)!
        return {
          product_id:  item.product_id,
          qty:         item.qty,
          price:       parseFloat(String(product.price)),
          productName: product.name,
        }
      })

      const subtotal = itemsWithPrice.reduce((sum, i) => sum + i.price * i.qty, 0)
      const shippingFee = dto.shipping_fee ?? 0
      const total = subtotal + shippingFee

      const order = await tx.order.create({
        data: {
          userId:          userId || null,
          customerName:    dto.customer_name,
          customerPhone:   dto.customer_phone,
          customerEmail:   dto.customer_email || null,
          // FE gửi customer_address, fallback về shipping_address
          customerAddress: dto.customer_address || dto.shipping_address || '',
          paymentMethod:   dto.payment_method || 'cod',
          shippingFee,
          note:            dto.note || null,
          subtotal,
          total,
          status: 'pending',
          items: {
            create: itemsWithPrice.map(i => ({
              product:     { connect: { id: i.product_id } },
              productName: i.productName,
              qty:         i.qty,
              price:       i.price,
            })),
          },
        },
        include: { items: true },
      })

      // Tạo Invoice với snapshot giá tại thời điểm đặt hàng
      await tx.invoice.create({
        data: {
          code:             invoiceCode('OD'),
          orderId:          order.id,
          customerName:     dto.customer_name,
          customerPhone:    dto.customer_phone,
          customerEmail:    dto.customer_email || null,
          subtotalSnapshot: subtotal,
          totalSnapshot:    total,
          paymentMethod:    dto.payment_method || 'cod',
          status:           'unpaid',
          items: {
            create: itemsWithPrice.map(i => ({
              description:       i.productName,
              quantity:          i.qty,
              unitPriceSnapshot: i.price,
              lineTotalSnapshot: i.price * i.qty,
            })),
          },
        },
      })

      // FE reads res.data — trả về { success: true, data: {...} }
      return { success: true, data: this.transform(order) }
    })
  }

  // ─── Đơn hàng của tôi ─────────────────────────────────────
  async findMyOrders(userId: string) {
    const orders = await this.prisma.order.findMany({
      where:   { userId },
      include: { items: true, invoices: true },
      orderBy: { createdAt: 'desc' },
    })
    return orders.map(this.transform)
  }

  // ─── Tất cả đơn hàng (admin) ──────────────────────────────
  async findAll(filters?: { status?: string }) {
    const orders = await this.prisma.order.findMany({
      where:   filters?.status ? { status: filters.status as any } : {},
      include: { items: true, invoices: true, user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return orders.map(this.transform)
  }

  // ─── Chi tiết đơn hàng ────────────────────────────────────
  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where:   { id },
      include: { items: true, invoices: { include: { items: true } } },
    })
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng')
    return this.transform(order)
  }

  async findOneForUser(id: string, user: any) {
    const order = await this.prisma.order.findUnique({
      where:   { id },
      include: { items: true, invoices: { include: { items: true } } },
    })
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng')
    if (user.role === 'admin' || user.role === 'employee') return this.transform(order)
    if (order.userId && order.userId === user.id) return this.transform(order)
    throw new ForbiddenException('Bạn không có quyền xem đơn hàng này')
  }

  // ─── Cập nhật trạng thái (admin) ──────────────────────────
  async updateStatus(id: string, newStatus: string) {
    const order = await this.prisma.order.findUnique({
      where:   { id },
      include: { invoices: true },
    })
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng')

    const allowedNext = ORDER_TRANSITIONS[order.status] ?? []
    if (!allowedNext.includes(newStatus)) {
      throw new BadRequestException(
        `Không thể chuyển từ "${order.status}" sang "${newStatus}". ` +
        `Trạng thái hợp lệ tiếp theo: [${allowedNext.join(', ') || 'không có'}]`
      )
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where:   { id },
        data:    { status: newStatus as any },
        include: { items: true, invoices: { include: { items: true } } },
      })

      // Đồng bộ trạng thái Invoice nếu cần
      const invoiceStatus = ORDER_STATUS_TO_INVOICE[newStatus]
      if (invoiceStatus && order.invoices.length > 0) {
        await tx.invoice.updateMany({
          where: { orderId: id },
          data:  { status: invoiceStatus as any },
        })
      }

      // FE reads res.data — trả về { success: true, data: {...} }
      return { success: true, data: this.transform(updated) }
    })
  }

  // ─── Lấy Invoice của đơn hàng ─────────────────────────────
  async getInvoice(orderId: string, user: any) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng')
    if (user.role !== 'admin' && user.role !== 'employee' && order.userId !== user.id) {
      throw new ForbiddenException('Bạn không có quyền xem hóa đơn này')
    }

    const invoice = await this.prisma.invoice.findFirst({
      where:   { orderId },
      include: { items: true },
    })
    if (!invoice) throw new NotFoundException('Chưa có hóa đơn cho đơn hàng này')

    return {
      id:               invoice.id,
      code:             invoice.code,
      orderId:          invoice.orderId,
      customerName:     invoice.customerName,
      customerPhone:    invoice.customerPhone,
      customerEmail:    invoice.customerEmail,
      subtotalSnapshot: parseFloat(String(invoice.subtotalSnapshot)),
      totalSnapshot:    parseFloat(String(invoice.totalSnapshot)),
      paymentMethod:    invoice.paymentMethod,
      status:           invoice.status,
      createdAt:        invoice.createdAt,
      items: invoice.items.map(it => ({
        id:                it.id,
        description:       it.description,
        quantity:          it.quantity,
        unitPriceSnapshot: parseFloat(String(it.unitPriceSnapshot)),
        lineTotalSnapshot: parseFloat(String(it.lineTotalSnapshot)),
      })),
    }
  }

  private transform(raw: any) {
    return {
      id:              raw.id,
      customerName:    raw.customerName,
      customerPhone:   raw.customerPhone,
      customerEmail:   raw.customerEmail,
      shippingAddress: raw.customerAddress,
      paymentMethod:   raw.paymentMethod,
      note:            raw.note,
      subtotal:        parseFloat(String(raw.subtotal)),
      shippingFee:     parseFloat(String(raw.shippingFee)),
      total:           parseFloat(String(raw.total)),
      status:          raw.status,
      createdAt:       raw.createdAt,
      allowedNextStatuses: ORDER_TRANSITIONS[raw.status] ?? [],
      items: (raw.items || []).map((i: any) => ({
        productId:   i.productId,
        productName: i.productName,
        quantity:    i.qty,
        price:       parseFloat(String(i.price)),
        lineTotal:   parseFloat(String(i.price)) * i.qty,
      })),
      invoices: (raw.invoices || []).map((inv: any) => ({
        id:               inv.id,
        code:             inv.code,
        status:           inv.status,
        subtotalSnapshot: parseFloat(String(inv.subtotalSnapshot)),
        totalSnapshot:    parseFloat(String(inv.totalSnapshot)),
        paymentMethod:    inv.paymentMethod,
        createdAt:        inv.createdAt,
      })),
    }
  }
}
