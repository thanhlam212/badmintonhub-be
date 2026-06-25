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

type StockCheckItem = {
  sku?: string
  qty: number
  productName?: string
  product?: { sku?: string }
}

async function checkStockForWarehouse(tx: any, warehouseId: number, items: StockCheckItem[]): Promise<boolean> {
  for (const item of items) {
    const sku = item.sku || item.product?.sku;
    if (!sku) return false;
    const inv = await tx.inventory.findUnique({
      where: { sku_warehouseId: { sku, warehouseId } }
    });
    if (!inv || inv.available < item.qty) {
      return false;
    }
  }
  return true;
}

function getOrderCoords(order: any): { lat: number; lng: number } | null {
  if (!order.customerCoords || typeof order.customerCoords !== 'object') return null
  const coords = order.customerCoords as any
  const lat = parseFloat(String(coords.lat))
  const lng = parseFloat(String(coords.lng))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

async function selectWarehouseWithStock(tx: any, order: any, items: StockCheckItem[]) {
  const candidates: any[] = []
  const seen = new Set<number>()
  const push = (warehouse: any) => {
    if (warehouse && !seen.has(warehouse.id)) {
      seen.add(warehouse.id)
      candidates.push(warehouse)
    }
  }

  const branchWarehouses = await tx.warehouse.findMany({
    where: { branchId: { not: null }, isActive: true },
    include: { branch: true },
    orderBy: { id: 'asc' },
  })

  let origin = getOrderCoords(order)
  if (order.deliveryMethod === 'pickup' && order.pickupBranchId) {
    const pickupBranch = await tx.branch.findUnique({ where: { id: order.pickupBranchId } })
    const pickupWarehouse = branchWarehouses.find((w: any) => w.branchId === order.pickupBranchId)
    push(pickupWarehouse)
    if (pickupBranch) {
      origin = {
        lat: parseFloat(String(pickupBranch.lat)),
        lng: parseFloat(String(pickupBranch.lng)),
      }
    }
  }

  const sortedBranches = origin
    ? branchWarehouses
        .map((warehouse: any) => ({
          warehouse,
          distance: haversineDistance(
            origin!.lat,
            origin!.lng,
            parseFloat(String(warehouse.branch?.lat || 0)),
            parseFloat(String(warehouse.branch?.lng || 0)),
          ),
        }))
        .sort((a: any, b: any) => a.distance - b.distance)
        .map((entry: any) => entry.warehouse)
    : branchWarehouses

  sortedBranches.forEach(push)

  const hubs = await tx.warehouse.findMany({
    where: { isHub: true, isActive: true },
    orderBy: { id: 'asc' },
  })
  hubs.forEach(push)

  for (const warehouse of candidates) {
    if (await checkStockForWarehouse(tx, warehouse.id, items)) {
      return warehouse
    }
  }

  return null
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
      const deliveryMethod = (dto.delivery_method || 'delivery') as any
      const stockItems = itemsWithPrice.map(item => {
        const product = products.find(p => p.id === item.product_id)!
        return {
          sku: product.sku,
          qty: item.qty,
          productName: product.name,
        }
      })
      const selectedWarehouse = await selectWarehouseWithStock(
        tx,
        {
          deliveryMethod,
          pickupBranchId: dto.pickup_branch_id || null,
          customerCoords: dto.customer_coords ? (dto.customer_coords as any) : null,
        },
        stockItems,
      )
      if (!selectedWarehouse) {
        throw new BadRequestException('Khong du ton kho kha dung tai cac kho gan khach hoac kho Hub')
      }

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
          deliveryMethod,
          pickupBranchId:  dto.pickup_branch_id || null,
          fulfillingWarehouseId: selectedWarehouse.id,
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
          fulfillingWarehouseId: selectedWarehouse.id,
          fulfilling_warehouse_id: selectedWarehouse.id,
          fulfillingWarehouseName: selectedWarehouse.name,
          fulfilling_warehouse_name: selectedWarehouse.name,
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
    return (await this.attachWarehouseNames(orders)).map(this.transform)
  }

  // ─── Tất cả đơn hàng (admin) ──────────────────────────────
  async findAll(filters?: { status?: string }) {
    await this.expireStaleUnpaidOrders()

    const orders = await this.prisma.order.findMany({
      where:   filters?.status ? { status: filters.status as any } : {},
      include: { items: true, invoices: true, user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return (await this.attachWarehouseNames(orders)).map(this.transform)
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
    return this.transform((await this.attachWarehouseNames([order]))[0])
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
    const enriched = (await this.attachWarehouseNames([order]))[0]
    if (user.role === 'admin' || user.role === 'employee') return this.transform(enriched)
    if (order.userId && order.userId === user.id) return this.transform(enriched)
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
        const stockItems = order.items.map((item: any) => ({
          sku: item.product.sku,
          qty: item.qty,
          productName: item.productName,
        }))

        if (order.fulfillingWarehouseId && await checkStockForWarehouse(tx, order.fulfillingWarehouseId, stockItems)) {
          selectedWarehouseId = order.fulfillingWarehouseId
        }

        if (!selectedWarehouseId) {
          const selectedWarehouse = await selectWarehouseWithStock(tx, order, stockItems)
          if (!selectedWarehouse) {
            throw new BadRequestException('Khong du ton kho kha dung tai cac kho gan khach hoac kho Hub')
          }
          selectedWarehouseId = selectedWarehouse.id
        }

        const invoiceCode = order.invoices[0]?.code || fallbackOrderCode(order)
        const warrantyCode = `BH-${invoiceCode}`
        const documentUserId = user?.id || order.approvedBy || order.userId
        if (!documentUserId) {
          throw new BadRequestException('Khong xac dinh duoc nhan vien xuat kho')
        }
        const slip = await tx.adminWarehouseSlip.create({
          data: {
            type: 'export',
            warehouseId: selectedWarehouseId,
            note: `Xuat kho don online ${invoiceCode}; phieu bao hanh ${warrantyCode}`,
            status: 'processed',
            createdBy: documentUserId,
            assignedTo: documentUserId,
            processedAt: new Date(),
            processedBy: documentUserId,
            items: {
              create: order.items.map((item: any) => ({
                sku: item.product.sku,
                name: item.productName,
                qty: item.qty,
                unitCost: item.price,
              })),
            },
          },
        })
        const slipCode = `PXK-${slip.id.slice(0, 8).toUpperCase()}`

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
          const inventoryTxn = await tx.inventoryTransaction.create({
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
          await tx.inventoryTransaction.update({
            where: { id: inventoryTxn.id },
            data: {
              note: `Xuat hang ban online | Hoa don: ${invoiceCode} | Phieu xuat: ${slipCode} | Bao hanh: ${warrantyCode}`,
            },
          })
          await this.prisma.syncProductInStock(tx, sku);
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
          await this.prisma.syncProductInStock(tx, sku);
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
      return { success: true, data: this.transform((await this.attachWarehouseNames([updated]))[0]) }
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

  private async attachWarehouseNames<T extends { fulfillingWarehouseId?: number | null }>(orders: T[]) {
    const warehouseIds = Array.from(new Set(
      orders
        .map(order => order.fulfillingWarehouseId)
        .filter((id): id is number => typeof id === 'number'),
    ))
    if (warehouseIds.length === 0) return orders

    const warehouses = await this.prisma.warehouse.findMany({
      where: { id: { in: warehouseIds } },
      select: { id: true, name: true },
    })
    const names = new Map(warehouses.map(warehouse => [warehouse.id, warehouse.name]))
    return orders.map(order => ({
      ...order,
      fulfillingWarehouseName: order.fulfillingWarehouseId
        ? names.get(order.fulfillingWarehouseId) ?? null
        : null,
      fulfilling_warehouse_name: order.fulfillingWarehouseId
        ? names.get(order.fulfillingWarehouseId) ?? null
        : null,
    }))
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
      fulfilling_warehouse_id: raw.fulfillingWarehouseId,
      fulfillingWarehouseName: raw.fulfillingWarehouseName ?? null,
      fulfilling_warehouse_name: raw.fulfilling_warehouse_name ?? raw.fulfillingWarehouseName ?? null,
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
