import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateOrderDto } from './dto/order.dto'
import { DOCUMENT_CODE_PATTERN, HOLD_EXPIRES_MINUTES, fallbackDocumentCode, nextInvoiceCode } from '../bookings/booking.helpers'
import { isAutoConfirmedGateway, normalizePaymentMethod } from '../common/payment-methods'

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

function fallbackOrderCode(order: any): string {
  return fallbackDocumentCode('OD', order)
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function checkStockForWarehouse(tx: any, warehouseId: number, items: any[]): Promise<boolean> {
  for (const item of items) {
    const sku = item.product.sku;
    const inv = await tx.inventory.findUnique({
      where: { sku_warehouseId: { sku, warehouseId } }
    });
    if (!inv || inv.available < item.qty) {
      return false;
    }
  }
  return true;
}

@Injectable()
export class OrderService {
  constructor(private prisma: PrismaService) {}

  private readonly uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  private readonly orderCodePattern = DOCUMENT_CODE_PATTERN

  // ─── Tạo đơn hàng mới ─────────────────────────────────────
  async create(dto: CreateOrderDto, userId?: string) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Đơn hàng phải có ít nhất 1 sản phẩm')
    }

    const paymentMethod = normalizePaymentMethod(dto.payment_method, 'cod')
    const autoConfirmed = isAutoConfirmedGateway(paymentMethod)
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
          paymentMethod,
          shippingFee,
          note:            dto.note || null,
          subtotal,
          total,
          status: autoConfirmed ? 'confirmed' : 'pending',
          deliveryMethod:  (dto.delivery_method || 'delivery') as any,
          pickupBranchId:  dto.pickup_branch_id || null,
          customerCoords:  dto.customer_coords ? (dto.customer_coords as any) : null,
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
      const code = await nextInvoiceCode(tx, 'OD')

      const invoice = await tx.invoice.create({
        data: {
          code,
          orderId:          order.id,
          customerName:     dto.customer_name,
          customerPhone:    dto.customer_phone,
          customerEmail:    dto.customer_email || null,
          subtotalSnapshot: subtotal,
          totalSnapshot:    total,
          paymentMethod,
          status:           autoConfirmed ? 'paid' : 'unpaid',
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
      return {
        success: true,
        data: {
          ...this.transform(order),
          orderCode: code,
          order_code: code,
          invoiceId: invoice.id,
          invoice_id: invoice.id,
          invoiceStatus: invoice.status,
          invoice_status: invoice.status,
          invoiceCode: code,
          invoice_code: code,
          sales_code: code,
        },
      }
    })
  }

  // ─── Đơn hàng của tôi ─────────────────────────────────────
  async findMyOrders(userId: string) {
    await this.expireStaleUnpaidOrders()

    const orders = await this.prisma.order.findMany({
      where:   { userId },
      include: { items: true, invoices: true },
      orderBy: { createdAt: 'desc' },
    })
    return orders.map(this.transform)
  }

  // ─── Tất cả đơn hàng (admin) ──────────────────────────────
  async findAll(filters?: { status?: string }) {
    await this.expireStaleUnpaidOrders()

    const orders = await this.prisma.order.findMany({
      where:   filters?.status ? { status: filters.status as any } : {},
      include: { items: true, invoices: true, user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return orders.map(this.transform)
  }

  // ─── Chi tiết đơn hàng ────────────────────────────────────
  async findOne(id: string) {
    await this.expireStaleUnpaidOrders()

    const resolvedId = await this.resolveOrderId(id)
    if (!resolvedId) throw new NotFoundException('Không tìm thấy đơn hàng')

    const order = await this.prisma.order.findUnique({
      where:   { id: resolvedId },
      include: { items: true, invoices: { include: { items: true } } },
    })
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng')
    return this.transform(order)
  }

  async findOneForUser(id: string, user: any) {
    await this.expireStaleUnpaidOrders()

    const resolvedId = await this.resolveOrderId(id)
    if (!resolvedId) throw new NotFoundException('Không tìm thấy đơn hàng')

    const order = await this.prisma.order.findUnique({
      where:   { id: resolvedId },
      include: { items: true, invoices: { include: { items: true } } },
    })
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng')
    if (user.role === 'admin' || user.role === 'employee') return this.transform(order)
    if (order.userId && order.userId === user.id) return this.transform(order)
    throw new ForbiddenException('Bạn không có quyền xem đơn hàng này')
  }

  // ─── Cập nhật trạng thái (admin) ──────────────────────────
  async updateStatus(id: string, newStatus: string, user?: any) {
    await this.expireStaleUnpaidOrders()

    const resolvedId = await this.resolveOrderId(id)
    if (!resolvedId) throw new NotFoundException('Không tìm thấy đơn hàng')

    const order = await this.prisma.order.findUnique({
      where:   { id: resolvedId },
      include: { invoices: true, items: { include: { product: true } } },
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
      let selectedWarehouseId: number | null = null;
      if (newStatus === 'processing') {
        if (order.deliveryMethod === 'pickup') {
          if (!order.pickupBranchId) {
            throw new BadRequestException('Đơn hàng nhận tại cửa hàng nhưng không có chi nhánh nhận');
          }
          const wh = await tx.warehouse.findFirst({
            where: { branchId: order.pickupBranchId, isActive: true }
          });
          if (!wh) {
            throw new BadRequestException('Không tìm thấy kho hoạt động cho chi nhánh nhận hàng');
          }
          const hasEnough = await checkStockForWarehouse(tx, wh.id, order.items);
          if (!hasEnough) {
            throw new BadRequestException(`Kho ${wh.name} không đủ tồn kho để hoàn thành đơn hàng`);
          }
          selectedWarehouseId = wh.id;
        } else {
          // Delivery order: find nearest warehouse with stock
          let lat: number | null = null;
          let lng: number | null = null;
          if (order.customerCoords && typeof order.customerCoords === 'object') {
            const coords = order.customerCoords as any;
            lat = parseFloat(coords.lat);
            lng = parseFloat(coords.lng);
          }

          if (lat !== null && !isNaN(lat) && lng !== null && !isNaN(lng)) {
            const branchWarehouses = await tx.warehouse.findMany({
              where: { branchId: { not: null }, isActive: true },
              include: { branch: true },
            });
            const sortedCandidates = branchWarehouses.map(w => {
              const wLat = parseFloat(String(w.branch?.lat || 0));
              const wLng = parseFloat(String(w.branch?.lng || 0));
              const distance = haversineDistance(lat!, lng!, wLat, wLng);
              return { warehouse: w, distance };
            }).sort((a, b) => a.distance - b.distance);

            for (const candidate of sortedCandidates) {
              const whId = candidate.warehouse.id;
              if (await checkStockForWarehouse(tx, whId, order.items)) {
                selectedWarehouseId = whId;
                break;
              }
            }
          }

          // If no branch warehouse has enough stock, or if customerCoords is missing, check Kho Hub
          if (!selectedWarehouseId) {
            const hub = await tx.warehouse.findFirst({
              where: { isHub: true, isActive: true }
            });
            if (hub && await checkStockForWarehouse(tx, hub.id, order.items)) {
              selectedWarehouseId = hub.id;
            }
          }

          // If still no warehouse has enough stock, default to nearest branch or Kho Hub and throw exception
          if (!selectedWarehouseId) {
            throw new BadRequestException('Không đủ tồn kho khả dụng tại bất kỳ chi nhánh nào hoặc kho Hub');
          }
        }

        // Deduct stock from the selected warehouse
        await tx.order.update({
          where: { id: resolvedId },
          data: { fulfillingWarehouseId: selectedWarehouseId }
        });

        for (const item of order.items) {
          const sku = item.product.sku;
          const inv = await tx.inventory.findUnique({
            where: { sku_warehouseId: { sku, warehouseId: selectedWarehouseId } }
          });
          await tx.inventory.update({
            where: { sku_warehouseId: { sku, warehouseId: selectedWarehouseId } },
            data: {
              onHand: { decrement: item.qty },
              available: { decrement: item.qty }
            }
          });
          await tx.inventoryTransaction.create({
            data: {
              type: 'export',
              date: new Date(),
              sku,
              warehouseId: selectedWarehouseId,
              qty: item.qty,
              cost: inv ? inv.unitCost : 0,
              note: `Xuất hàng bán online (Đơn: ${order.id})`,
              operatorId: user?.id || null,
            }
          });
        }
      }

      if (newStatus === 'cancelled' && order.fulfillingWarehouseId) {
        const whId = order.fulfillingWarehouseId;
        for (const item of order.items) {
          const sku = item.product.sku;
          await tx.inventory.update({
            where: { sku_warehouseId: { sku, warehouseId: whId } },
            data: {
              onHand: { increment: item.qty },
              available: { increment: item.qty }
            }
          });
          const inv = await tx.inventory.findUnique({
            where: { sku_warehouseId: { sku, warehouseId: whId } }
          });
          await tx.inventoryTransaction.create({
            data: {
              type: 'import',
              date: new Date(),
              sku,
              warehouseId: whId,
              qty: item.qty,
              cost: inv ? inv.unitCost : 0,
              note: `Nhập lại hàng do hủy đơn online (Đơn: ${order.id})`,
              operatorId: user?.id || null,
            }
          });
        }
      }

      const updated = await tx.order.update({
        where:   { id: resolvedId },
        data:    { status: newStatus as any },
        include: { items: true, invoices: { include: { items: true } } },
      })

      // Đồng bộ trạng thái Invoice nếu cần
      const invoiceStatus = ORDER_STATUS_TO_INVOICE[newStatus]
      if (invoiceStatus && order.invoices.length > 0) {
        await tx.invoice.updateMany({
          where: { orderId: resolvedId },
          data:  { status: invoiceStatus as any },
        })
      }

      // FE reads res.data — trả về { success: true, data: {...} }
      return { success: true, data: this.transform(updated) }
    })
  }

  // ─── Lấy Invoice của đơn hàng ─────────────────────────────
  async getInvoice(orderId: string, user: any) {
    await this.expireStaleUnpaidOrders()

    const resolvedId = await this.resolveOrderId(orderId)
    if (!resolvedId) throw new NotFoundException('Không tìm thấy đơn hàng')

    const order = await this.prisma.order.findUnique({ where: { id: resolvedId } })
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng')
    if (user.role !== 'admin' && user.role !== 'employee' && order.userId !== user.id) {
      throw new ForbiddenException('Bạn không có quyền xem hóa đơn này')
    }

    const invoice = await this.prisma.invoice.findFirst({
      where:   { orderId: resolvedId },
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

  private async expireStaleUnpaidOrders() {
    const expiresBefore = new Date(Date.now() - HOLD_EXPIRES_MINUTES * 60 * 1000)
    const staleOrders = await this.prisma.order.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: expiresBefore },
        invoices: { some: { status: 'unpaid' } },
      },
      select: { id: true },
    })
    const orderIds = (staleOrders || []).map((order) => order.id)
    if (orderIds.length === 0) return

    await this.prisma.$transaction(async (tx) => {
      await tx.order.updateMany({
        where: { id: { in: orderIds }, status: 'pending' },
        data: { status: 'cancelled' as any },
      })
      await tx.invoice.updateMany({
        where: { orderId: { in: orderIds }, status: 'unpaid' },
        data: { status: 'cancelled' as any },
      })
    })
  }

  private transform(raw: any) {
    const latestInvoice = [...(raw.invoices || [])].sort(
      (a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt)
    )[0]
    const latestInvoiceCode = latestInvoice?.code && DOCUMENT_CODE_PATTERN.test(latestInvoice.code)
      ? latestInvoice.code
      : null
    const latestInvoiceId = latestInvoice?.id ?? raw.invoiceId ?? raw.invoice_id ?? null
    const latestInvoiceStatus = latestInvoice?.status ?? raw.invoiceStatus ?? raw.invoice_status ?? null
    const orderCode = latestInvoiceCode || fallbackOrderCode(raw)

    return {
      id:              raw.id,
      orderCode,
      order_code:      orderCode,
      invoiceId:       latestInvoiceId,
      invoice_id:      latestInvoiceId,
      invoiceStatus:   latestInvoiceStatus,
      invoice_status:  latestInvoiceStatus,
      invoiceCode:     latestInvoiceCode,
      invoice_code:    latestInvoiceCode,
      sales_code:      orderCode,
      userId:          raw.userId ?? null,
      customerName:    raw.customerName,
      customerPhone:   raw.customerPhone,
      customerEmail:   raw.customerEmail,
      shippingAddress: raw.customerAddress,
      paymentMethod:   raw.paymentMethod,
      note:            raw.note,
      subtotal:        parseFloat(String(raw.subtotal)),
      shippingFee:     parseFloat(String(raw.shippingFee)),
      total:           parseFloat(String(raw.total)),
      totalAmount:     parseFloat(String(raw.total)),
      status:          raw.status,
      createdAt:       raw.createdAt,
      deliveryMethod:  raw.deliveryMethod,
      pickupBranchId:  raw.pickupBranchId,
      fulfillingWarehouseId: raw.fulfillingWarehouseId,
      customerCoords:  raw.customerCoords,
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
        code:             DOCUMENT_CODE_PATTERN.test(inv.code) ? inv.code : fallbackOrderCode(raw),
        status:           inv.status,
        subtotalSnapshot: parseFloat(String(inv.subtotalSnapshot)),
        totalSnapshot:    parseFloat(String(inv.totalSnapshot)),
        paymentMethod:    inv.paymentMethod,
        createdAt:        inv.createdAt,
      })),
    }
  }

  private async resolveOrderId(input: string): Promise<string | null> {
    const value = String(input || '').trim()
    if (!value) return null
    if (this.uuidPattern.test(value)) return value
    if (!this.orderCodePattern.test(value)) return value

    const invoice = await this.prisma.invoice.findFirst({
      where: { code: value.toUpperCase() },
      select: { orderId: true },
    })

    return invoice?.orderId || null
  }
}
