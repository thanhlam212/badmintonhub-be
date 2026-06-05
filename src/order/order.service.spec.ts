import { Test, TestingModule } from '@nestjs/testing'
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common'
import { OrderService } from './order.service'
import { PrismaService } from '../prisma/prisma.service'

// ─── Helpers ─────────────────────────────────────────────────

function makeProduct(id: number, price: number, name = `Product ${id}`) {
  return { id, name, price: price.toString() }
}

function makeOrder(overrides: Partial<any> = {}): any {
  return {
    id:              'order-uuid-001',
    customerName:    'Nguyen Van A',
    customerPhone:   '0901234567',
    customerEmail:   'test@test.com',
    customerAddress: '123 ABC Street',
    paymentMethod:   'cod',
    note:            null,
    subtotal:        '300000',
    shippingFee:     '0',
    total:           '300000',
    status:          'pending',
    userId:          null,
    createdAt:       new Date(),
    items:           [],
    invoices:        [],
    ...overrides,
  }
}

function makeInvoice(overrides: Partial<any> = {}): any {
  return {
    id:               'inv-uuid-001',
    code:             'ORD-111-001',
    orderId:          'order-uuid-001',
    status:           'unpaid',
    subtotalSnapshot: '300000',
    totalSnapshot:    '300000',
    paymentMethod:    'cod',
    createdAt:        new Date(),
    items:            [],
    ...overrides,
  }
}

// ─── Prisma mock ─────────────────────────────────────────────

function makePrismaMock() {
  const mock = {
    product: { findMany:  jest.fn() },
    order:   {
      create:     jest.fn(),
      findUnique: jest.fn(),
      findMany:   jest.fn(),
      update:     jest.fn(),
    },
    invoice: {
      create:     jest.fn(),
      findFirst:  jest.fn(),
      updateMany: jest.fn(),
    },
    warehouse: {
      findFirst:  jest.fn(),
      findMany:   jest.fn(),
    },
    inventory: {
      findUnique: jest.fn(),
      update:     jest.fn(),
    },
    inventoryTransaction: {
      create:     jest.fn(),
    },
    $transaction: jest.fn(),
  }
  mock.$transaction.mockImplementation(async (fn: (tx: any) => any) => fn(mock))
  return mock
}

// ─── Tests ───────────────────────────────────────────────────

describe('OrderService', () => {
  let service: OrderService
  let prisma:  ReturnType<typeof makePrismaMock>

  beforeEach(async () => {
    prisma = makePrismaMock()
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()

    service = module.get<OrderService>(OrderService)
  })

  // ─── create ────────────────────────────────────────────────
  describe('create', () => {
    const dto = {
      customer_name:    'Nguyen Van A',
      customer_phone:   '0901234567',
      customer_email:   'a@test.com',
      shipping_address: '123 ABC',
      payment_method:   'cod',
      items: [
        { product_id: 1, qty: 2, price: 9999 }, // FE price ignored
        { product_id: 2, qty: 1, price: 9999 },
      ],
    }

    it('should create order and invoice successfully', async () => {
      prisma.product.findMany.mockResolvedValue([
        makeProduct(1, 100000),
        makeProduct(2, 150000),
      ])
      prisma.order.create.mockResolvedValue(makeOrder({ items: [] }))
      prisma.invoice.create.mockResolvedValue(makeInvoice())

      const result = await service.create(dto)

      expect(result.success).toBe(true)
      expect(prisma.order.create).toHaveBeenCalledTimes(1)
      expect(prisma.invoice.create).toHaveBeenCalledTimes(1)
    })

    it('should calculate total from DB prices, NOT from FE-provided prices', async () => {
      prisma.product.findMany.mockResolvedValue([
        makeProduct(1, 100000), // real price
        makeProduct(2, 150000),
      ])
      prisma.order.create.mockResolvedValue(makeOrder())
      prisma.invoice.create.mockResolvedValue(makeInvoice())

      await service.create(dto)

      const orderCreateCall = prisma.order.create.mock.calls[0][0]
      // 100000 * 2 + 150000 * 1 = 350000 (not 9999 * 3 from FE)
      expect(Number(orderCreateCall.data.subtotal)).toBe(350000)
      expect(Number(orderCreateCall.data.total)).toBe(350000)
    })

    it('should create invoice with snapshot prices matching order total', async () => {
      prisma.product.findMany.mockResolvedValue([
        makeProduct(1, 100000),
        makeProduct(2, 150000),
      ])
      prisma.order.create.mockResolvedValue(makeOrder())
      prisma.invoice.create.mockResolvedValue(makeInvoice())

      await service.create(dto)

      const invoiceCreateCall = prisma.invoice.create.mock.calls[0][0]
      expect(Number(invoiceCreateCall.data.subtotalSnapshot)).toBe(350000)
      expect(Number(invoiceCreateCall.data.totalSnapshot)).toBe(350000)
    })

    it('should create invoice items with per-product snapshot prices', async () => {
      prisma.product.findMany.mockResolvedValue([
        makeProduct(1, 100000, 'Vợt cầu'),
        makeProduct(2, 150000, 'Giày cầu'),
      ])
      prisma.order.create.mockResolvedValue(makeOrder())
      prisma.invoice.create.mockResolvedValue(makeInvoice())

      await service.create(dto)

      const invoiceCreateCall = prisma.invoice.create.mock.calls[0][0]
      const items = invoiceCreateCall.data.items.create
      expect(items).toHaveLength(2)

      const item1 = items.find((i: any) => i.description === 'Vợt cầu')
      expect(item1.unitPriceSnapshot).toBe(100000)
      expect(item1.lineTotalSnapshot).toBe(200000) // 100000 * 2
      expect(item1.quantity).toBe(2) // invoice snapshot uses qty=2
    })

    it('should set invoice status to unpaid for COD orders', async () => {
      prisma.product.findMany.mockResolvedValue([makeProduct(1, 100000)])
      prisma.order.create.mockResolvedValue(makeOrder())
      prisma.invoice.create.mockResolvedValue(makeInvoice())

      await service.create({ ...dto, payment_method: 'cod', items: [{ product_id: 1, qty: 1, price: 0 }] })

      const invoiceCreateCall = prisma.invoice.create.mock.calls[0][0]
      expect(invoiceCreateCall.data.status).toBe('unpaid')
    })

    it.each(['sepay', 'vnpay', 'momo'])('should keep %s orders pending until payment callback succeeds', async (method) => {
      prisma.product.findMany.mockResolvedValue([makeProduct(1, 100000)])
      prisma.order.create.mockResolvedValue(makeOrder({ paymentMethod: method, status: 'pending' }))
      prisma.invoice.create.mockResolvedValue(makeInvoice({ paymentMethod: method, status: 'unpaid' }))

      await service.create({ ...dto, payment_method: method, items: [{ product_id: 1, qty: 1, price: 0 }] })

      const orderCreateCall = prisma.order.create.mock.calls[0][0]
      const invoiceCreateCall = prisma.invoice.create.mock.calls[0][0]
      expect(orderCreateCall.data.paymentMethod).toBe(method)
      expect(orderCreateCall.data.status).toBe('pending')
      expect(invoiceCreateCall.data.paymentMethod).toBe(method)
      expect(invoiceCreateCall.data.status).toBe('unpaid')
    })

    it('should throw BadRequestException when items array is empty', async () => {
      await expect(service.create({ ...dto, items: [] })).rejects.toThrow(BadRequestException)
    })

    it('should throw BadRequestException when a product does not exist', async () => {
      prisma.product.findMany.mockResolvedValue([makeProduct(1, 100000)]) // only 1 found, but 2 requested

      await expect(service.create(dto)).rejects.toThrow(BadRequestException)
    })
  })

  // ─── updateStatus — state machine ─────────────────────────
  describe('updateStatus', () => {
    function mockOrderWithStatus(status: string) {
      const order = makeOrder({ status, invoices: [makeInvoice()] })
      prisma.order.findUnique.mockResolvedValue(order)
      prisma.order.update.mockResolvedValue({ ...order, status: 'confirmed', items: [], invoices: [] })
      prisma.invoice.updateMany.mockResolvedValue({ count: 1 })
      prisma.warehouse.findFirst.mockResolvedValue({ id: 1, name: 'Kho Cầu Giấy' })
      prisma.warehouse.findMany.mockResolvedValue([{ id: 1, name: 'Kho Cầu Giấy', branch: { lat: 21.0379, lng: 105.7826 } }])
      prisma.inventory.findUnique.mockResolvedValue({ id: 1, available: 100, unitCost: 10000 })
      prisma.inventory.update.mockResolvedValue({ id: 1 })
      prisma.inventoryTransaction.create.mockResolvedValue({ id: 'txn-1' })
    }

    // ── Valid transitions ────────────────────────────────────
    it('should allow pending → confirmed', async () => {
      mockOrderWithStatus('pending')
      const result = await service.updateStatus('order-uuid-001', 'confirmed')
      expect(result.success).toBe(true)
    })

    it('should allow pending → cancelled', async () => {
      mockOrderWithStatus('pending')
      prisma.order.update.mockResolvedValue(makeOrder({ status: 'cancelled', items: [], invoices: [] }))
      const result = await service.updateStatus('order-uuid-001', 'cancelled')
      expect(result.success).toBe(true)
    })

    it('should allow confirmed → processing', async () => {
      mockOrderWithStatus('confirmed')
      const result = await service.updateStatus('order-uuid-001', 'processing')
      expect(result.success).toBe(true)
    })

    it('should allow processing → shipping', async () => {
      mockOrderWithStatus('processing')
      const result = await service.updateStatus('order-uuid-001', 'shipping')
      expect(result.success).toBe(true)
    })

    it('should allow shipping → delivered', async () => {
      mockOrderWithStatus('shipping')
      const result = await service.updateStatus('order-uuid-001', 'delivered')
      expect(result.success).toBe(true)
    })

    it('should allow delivered → refunded', async () => {
      mockOrderWithStatus('delivered')
      const result = await service.updateStatus('order-uuid-001', 'refunded')
      expect(result.success).toBe(true)
    })

    // ── Invalid transitions ──────────────────────────────────
    it('should throw BadRequestException for pending → shipping (skip steps)', async () => {
      mockOrderWithStatus('pending')
      await expect(service.updateStatus('order-uuid-001', 'shipping')).rejects.toThrow(BadRequestException)
    })

    it('should throw BadRequestException for pending → delivered', async () => {
      mockOrderWithStatus('pending')
      await expect(service.updateStatus('order-uuid-001', 'delivered')).rejects.toThrow(BadRequestException)
    })

    it('should throw BadRequestException for delivered → processing (go backwards)', async () => {
      mockOrderWithStatus('delivered')
      await expect(service.updateStatus('order-uuid-001', 'processing')).rejects.toThrow(BadRequestException)
    })

    it('should throw BadRequestException for cancelled → confirmed (revive cancelled)', async () => {
      mockOrderWithStatus('cancelled')
      await expect(service.updateStatus('order-uuid-001', 'confirmed')).rejects.toThrow(BadRequestException)
    })

    it('should throw BadRequestException for refunded → any (terminal state)', async () => {
      mockOrderWithStatus('refunded')
      await expect(service.updateStatus('order-uuid-001', 'pending')).rejects.toThrow(BadRequestException)
    })

    // ── Invoice sync ─────────────────────────────────────────
    it('should sync invoice to cancelled when order is cancelled', async () => {
      mockOrderWithStatus('pending')
      prisma.order.update.mockResolvedValue(makeOrder({ status: 'cancelled', items: [], invoices: [] }))

      await service.updateStatus('order-uuid-001', 'cancelled')

      expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'cancelled' } })
      )
    })

    it('should sync invoice to paid when order is delivered', async () => {
      mockOrderWithStatus('shipping')
      prisma.order.update.mockResolvedValue(makeOrder({ status: 'delivered', items: [], invoices: [] }))

      await service.updateStatus('order-uuid-001', 'delivered')

      expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'paid' } })
      )
    })

    it('should sync invoice to refunded when order is refunded', async () => {
      mockOrderWithStatus('delivered')
      prisma.order.update.mockResolvedValue(makeOrder({ status: 'refunded', items: [], invoices: [] }))

      await service.updateStatus('order-uuid-001', 'refunded')

      expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'refunded' } })
      )
    })

    it('should NOT update invoice when transitioning to confirmed/processing/shipping', async () => {
      mockOrderWithStatus('pending')

      await service.updateStatus('order-uuid-001', 'confirmed')

      // No invoice sync needed for intermediate states
      expect(prisma.invoice.updateMany).not.toHaveBeenCalled()
    })

    // ── Not found ────────────────────────────────────────────
    it('should throw NotFoundException when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null)

      await expect(service.updateStatus('nonexistent', 'confirmed')).rejects.toThrow(NotFoundException)
    })
  })

  // ─── findOneForUser ────────────────────────────────────────
  describe('findOneForUser', () => {
    it('should return order for admin user', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder())

      const result = await service.findOneForUser('order-uuid-001', { role: 'admin', id: 'admin-001' })

      expect(result).toBeDefined()
    })

    it('should return order when userId matches', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder({ userId: 'user-001' }))

      const result = await service.findOneForUser('order-uuid-001', { role: 'user', id: 'user-001' })

      expect(result).toBeDefined()
    })

    it('should throw ForbiddenException when user does not own the order', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder({ userId: 'other-user' }))

      await expect(
        service.findOneForUser('order-uuid-001', { role: 'user', id: 'current-user' })
      ).rejects.toThrow(ForbiddenException)
    })

    it('should throw NotFoundException when order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null)

      await expect(
        service.findOneForUser('nonexistent', { role: 'admin', id: 'admin-001' })
      ).rejects.toThrow(NotFoundException)
    })
  })
})
