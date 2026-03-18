// src/orders/orders.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateOrderDto } from './dto/order.dto'
import { OrderStatus } from '@prisma/client'

@Injectable()
export class OrderService {
  constructor(private prisma: PrismaService) {}

  // ─── Tạo đơn hàng mới ─────────────────────────────────────
  async create(dto: CreateOrderDto, userId?: string) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Đơn hàng phải có ít nhất 1 sản phẩm')
    }

    // Verify products + tính tổng tiền từ DB (không tin giá FE)
    const productIds = dto.items.map(i => i.product_id)
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
    })

    if (products.length !== productIds.length) {
      throw new BadRequestException('Một số sản phẩm không tồn tại')
    }

    const total = dto.items.reduce((sum, item) => {
      const product = products.find(p => p.id === item.product_id)!
      return sum + parseFloat(String(product.price)) * item.quantity
    }, 0)

    const order = await this.prisma.order.create({
      data: {
        userId:          userId || null,
        customerName:    dto.customer_name,
        customerPhone:   dto.customer_phone,
        customerEmail:   dto.customer_email || null,
        customerAddress: dto.shipping_address,
        paymentMethod:   dto.payment_method || 'cod',
        shippingFee:    0, 
        note:            dto.note || null,
        subtotal:          total,
        total:          total, 
        status:          'pending',
        items: {
          create: dto.items.map(item => {
        const product = products.find(p => p.id === item.product_id)!
        return {
                product:  { connect: { id: item.product_id } },  
                productName: product.name,
                qty:         item.quantity,      
                price:       parseFloat(String(product.price)),
            }
         }),
        },
      },
      include: { items: true },
    })

    return { success: true, order }
  }

  // ─── Đơn hàng của tôi ─────────────────────────────────────
  async findMyOrders(userId: string) {
    const orders = await this.prisma.order.findMany({
      where:   { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    })
    return orders.map(this.transform)
  }

  // ─── Tất cả đơn hàng (admin) ──────────────────────────────
  async findAll(filters?: { status?: string }) {
    const orders = await this.prisma.order.findMany({
      where: filters ?.status ? { status: filters.status as OrderStatus } : {},
      include: { items: true, user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return orders.map(this.transform)
  }

  // ─── Chi tiết đơn hàng ────────────────────────────────────
  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where:   { id },
      include: { items: true },
    })
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng')
    return this.transform(order)
  }

  // ─── Cập nhật trạng thái (admin) ──────────────────────────
  async updateStatus(id: string, status: string) {
    const order = await this.findOne(id)
    const valid = ['pending', 'processing', 'shipping', 'delivered', 'cancelled']
    if (!valid.includes(status)) {
      throw new BadRequestException('Trạng thái không hợp lệ')
    }
    const updated = await this.prisma.order.update({
      where:   { id },
      data: { status: status as OrderStatus },
      include: { items: true },
    })
    return { success: true, order: this.transform(updated) }
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
      amount:          parseFloat(String(raw.total)),
      status:          raw.status,
      createdAt:       raw.createdAt,
      items: (raw.items || []).map((i: any) => ({
        productId:   i.productId,
        productName: i.productName,
        sku:         i.sku,
        quantity:    i.quantity,
        price:       parseFloat(String(i.price)),
      })),
    }
  }
}