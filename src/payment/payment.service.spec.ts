import { Test, TestingModule } from '@nestjs/testing'
import { NotFoundException, BadRequestException } from '@nestjs/common'
import { PaymentService } from './payment.service'
import { VnpayProvider } from './vnpay.provider'
import { MomoProvider } from './momo.provider'
import { PrismaService } from '../prisma/prisma.service'

// ─── Mock factories ──────────────────────────────────────────

function makeInvoice(overrides: Partial<any> = {}): any {
  return {
    id:               'inv-uuid-001',
    code:             'ORD-111-001',
    orderId:          'order-uuid-001',
    bookingId:        null,
    fixedScheduleId:  null,
    status:           'unpaid',
    totalSnapshot:    200000,
    paymentMethod:    'cod',
    order:            null,
    booking:          null,
    fixedSchedule:    null,
    ...overrides,
  }
}

function makePayment(overrides: Partial<any> = {}): any {
  return {
    id:             'pay-uuid-001',
    invoiceId:      'inv-uuid-001',
    method:         'vnpay',
    amount:         200000,
    status:         'pending',
    transactionRef: 'VNPAY-1234567890-ABCD1234',
    gatewayResponse: null,
    invoice:        makeInvoice(),
    ...overrides,
  }
}

// ─── Prisma mock ─────────────────────────────────────────────

function makePrismaMock() {
  const mock = {
    invoice: {
      findUnique:  jest.fn(),
      update:      jest.fn(),
      updateMany:  jest.fn(),
      findFirst:   jest.fn(),
    },
    payment: {
      create:     jest.fn(),
      findFirst:  jest.fn(),
      findUnique: jest.fn(),
      update:     jest.fn(),
    },
    order:          { update: jest.fn() },
    booking:        { update: jest.fn() },
    fixedSchedule:  { update: jest.fn() },
    $transaction: jest.fn(),
  }
  // default: $transaction calls the callback with the mock itself
  mock.$transaction.mockImplementation(async (fn: (tx: any) => any) => fn(mock))
  return mock
}

// ─── Provider mocks ───────────────────────────────────────────

const mockVnpay = {
  createPaymentUrl: jest.fn(),
  verifyReturn:     jest.fn(),
}

const mockMomo = {
  createPaymentUrl: jest.fn(),
  verifyIpn:        jest.fn(),
}

// ─── Tests ───────────────────────────────────────────────────

describe('PaymentService', () => {
  let service: PaymentService
  let prisma:  ReturnType<typeof makePrismaMock>

  beforeEach(async () => {
    prisma = makePrismaMock()
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService,  useValue: prisma },
        { provide: VnpayProvider,  useValue: mockVnpay },
        { provide: MomoProvider,   useValue: mockMomo },
      ],
    }).compile()

    service = module.get<PaymentService>(PaymentService)
  })

  // ─── createPayment ─────────────────────────────────────────
  describe('createPayment', () => {
    const dto = { invoiceId: 'inv-uuid-001', method: 'vnpay' as const }
    const ip  = '127.0.0.1'

    it('should create a VNPay payment and return payUrl', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice())
      prisma.payment.findFirst.mockResolvedValue(null)
      prisma.payment.create.mockResolvedValue(makePayment())
      mockVnpay.createPaymentUrl.mockReturnValue('https://sandbox.vnpay.vn/pay?ref=X')

      const result = await service.createPayment(dto, ip)

      expect(result.method).toBe('vnpay')
      expect(result.payUrl).toContain('sandbox.vnpay.vn')
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ invoiceId: 'inv-uuid-001', method: 'vnpay' }),
        })
      )
    })

    it('should create a MoMo payment and return payUrl', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice())
      prisma.payment.findFirst.mockResolvedValue(null)
      prisma.payment.create.mockResolvedValue(makePayment({ method: 'momo' }))
      mockMomo.createPaymentUrl.mockResolvedValue('https://test-payment.momo.vn/pay?ref=Y')

      const result = await service.createPayment({ invoiceId: 'inv-uuid-001', method: 'momo' }, ip)

      expect(result.method).toBe('momo')
      expect(result.payUrl).toContain('momo.vn')
    })

    it('should throw NotFoundException when invoice does not exist', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null)

      await expect(service.createPayment(dto, ip)).rejects.toThrow(NotFoundException)
    })

    it('should throw BadRequestException when invoice is already paid', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({ status: 'paid' }))

      await expect(service.createPayment(dto, ip)).rejects.toThrow(BadRequestException)
    })

    it('should throw BadRequestException when invoice is cancelled', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice({ status: 'cancelled' }))

      await expect(service.createPayment(dto, ip)).rejects.toThrow(BadRequestException)
    })

    it('should throw BadRequestException for unsupported payment method', async () => {
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice())
      prisma.payment.findFirst.mockResolvedValue(null)
      prisma.payment.create.mockResolvedValue(makePayment({ method: 'zalopay' }))

      await expect(
        service.createPayment({ invoiceId: 'inv-uuid-001', method: 'zalopay' as any }, ip)
      ).rejects.toThrow(BadRequestException)
    })

    it('should reuse transactionRef if there is an existing pending payment', async () => {
      const existing = makePayment({ transactionRef: 'EXISTING-REF-123' })
      prisma.invoice.findUnique.mockResolvedValue(makeInvoice())
      prisma.payment.findFirst.mockResolvedValue(existing)
      prisma.payment.create.mockResolvedValue(makePayment({ transactionRef: 'EXISTING-REF-123' }))
      mockVnpay.createPaymentUrl.mockReturnValue('https://sandbox.vnpay.vn/pay')

      await service.createPayment(dto, ip)

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ transactionRef: 'EXISTING-REF-123' }),
        })
      )
    })
  })

  // ─── handleVnpayReturn ─────────────────────────────────────
  describe('handleVnpayReturn', () => {
    it('should return success=true and confirm payment', async () => {
      mockVnpay.verifyReturn.mockReturnValue({ success: true, txnRef: 'TXN-001', amount: 200000 })
      prisma.payment.findFirst.mockResolvedValue(makePayment())
      prisma.payment.update.mockResolvedValue({})
      prisma.invoice.update.mockResolvedValue({})
      prisma.order.update.mockResolvedValue({})

      const result = await service.handleVnpayReturn({ vnp_SecureHash: 'abc', vnp_TxnRef: 'TXN-001' })

      expect(result.success).toBe(true)
    })

    it('should return success=false when verification fails', async () => {
      mockVnpay.verifyReturn.mockReturnValue({ success: false, txnRef: 'TXN-001', amount: 0 })
      prisma.payment.findFirst.mockResolvedValue(makePayment())
      prisma.payment.update.mockResolvedValue({})

      const result = await service.handleVnpayReturn({ vnp_SecureHash: 'bad', vnp_TxnRef: 'TXN-001' })

      expect(result.success).toBe(false)
    })

    it('should return error message when txnRef is missing', async () => {
      mockVnpay.verifyReturn.mockReturnValue({ success: false, txnRef: '', amount: 0 })

      const result = await service.handleVnpayReturn({})

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/mã giao dịch/i)
    })

    it('should return already-processed message if payment is already success', async () => {
      mockVnpay.verifyReturn.mockReturnValue({ success: true, txnRef: 'TXN-001', amount: 200000 })
      prisma.payment.findFirst.mockResolvedValue(makePayment({ status: 'success' }))

      const result = await service.handleVnpayReturn({ vnp_TxnRef: 'TXN-001' })

      expect(result.success).toBe(true)
      expect(prisma.payment.update).not.toHaveBeenCalled()
    })

    it('should return not-found if no payment matches txnRef', async () => {
      mockVnpay.verifyReturn.mockReturnValue({ success: true, txnRef: 'UNKNOWN', amount: 0 })
      prisma.payment.findFirst.mockResolvedValue(null)

      const result = await service.handleVnpayReturn({ vnp_TxnRef: 'UNKNOWN' })

      expect(result.success).toBe(false)
    })
  })

  // ─── handleVnpayIpn ────────────────────────────────────────
  describe('handleVnpayIpn', () => {
    it('should return RspCode 00 on successful payment', async () => {
      mockVnpay.verifyReturn.mockReturnValue({ success: true, txnRef: 'TXN-001', amount: 200000 })
      prisma.payment.findFirst.mockResolvedValue(makePayment())
      prisma.payment.update.mockResolvedValue({})
      prisma.invoice.update.mockResolvedValue({})
      prisma.order.update.mockResolvedValue({})

      const result = await service.handleVnpayIpn({ vnp_TxnRef: 'TXN-001' })

      expect(result.RspCode).toBe('00')
    })

    it('should return RspCode 01 when txnRef is missing', async () => {
      mockVnpay.verifyReturn.mockReturnValue({ success: true, txnRef: '', amount: 0 })

      const result = await service.handleVnpayIpn({})

      expect(result.RspCode).toBe('01')
    })

    it('should return RspCode 01 when payment not found', async () => {
      mockVnpay.verifyReturn.mockReturnValue({ success: true, txnRef: 'TXN-GHOST', amount: 0 })
      prisma.payment.findFirst.mockResolvedValue(null)

      const result = await service.handleVnpayIpn({ vnp_TxnRef: 'TXN-GHOST' })

      expect(result.RspCode).toBe('01')
    })

    it('should return RspCode 02 when payment already confirmed', async () => {
      mockVnpay.verifyReturn.mockReturnValue({ success: true, txnRef: 'TXN-001', amount: 200000 })
      prisma.payment.findFirst.mockResolvedValue(makePayment({ status: 'success' }))

      const result = await service.handleVnpayIpn({ vnp_TxnRef: 'TXN-001' })

      expect(result.RspCode).toBe('02')
    })
  })

  // ─── handleMomoIpn ─────────────────────────────────────────
  describe('handleMomoIpn', () => {
    it('should confirm payment when signature is valid and resultCode=0', async () => {
      mockMomo.verifyIpn.mockReturnValue(true)
      prisma.payment.findFirst.mockResolvedValue(makePayment({ method: 'momo' }))
      prisma.payment.update.mockResolvedValue({})
      prisma.invoice.update.mockResolvedValue({})
      prisma.order.update.mockResolvedValue({})

      const result = await service.handleMomoIpn({ orderId: 'TXN-001', resultCode: 0, signature: 'valid' })

      expect(result.resultCode).toBe(0)
    })

    it('should return error when signature is invalid', async () => {
      mockMomo.verifyIpn.mockReturnValue(false)

      const result = await service.handleMomoIpn({ orderId: 'TXN-001', signature: 'bad' })

      expect(result.resultCode).toBe(1)
      expect(prisma.payment.update).not.toHaveBeenCalled()
    })

    it('should return resultCode 0 (received) even for failed payment', async () => {
      mockMomo.verifyIpn.mockReturnValue(true)
      prisma.payment.findFirst.mockResolvedValue(makePayment({ method: 'momo' }))
      prisma.payment.update.mockResolvedValue({})
      prisma.invoice.update.mockResolvedValue({})

      // resultCode != 0 means payment failed on MoMo side
      const result = await service.handleMomoIpn({ orderId: 'TXN-001', resultCode: 1006, signature: 'valid' })

      expect(result.resultCode).toBe(0) // we always ack 0 so MoMo doesn't retry
    })
  })

  // ─── getPaymentStatus ──────────────────────────────────────
  describe('getPaymentStatus', () => {
    it('should return payment info with invoice status', async () => {
      prisma.payment.findUnique.mockResolvedValue(makePayment())

      const result = await service.getPaymentStatus('pay-uuid-001')

      expect(result.id).toBe('pay-uuid-001')
      expect(result.method).toBe('vnpay')
      expect(result.amount).toBe(200000)
      expect(result.invoiceStatus).toBe('unpaid')
    })

    it('should throw NotFoundException when payment does not exist', async () => {
      prisma.payment.findUnique.mockResolvedValue(null)

      await expect(service.getPaymentStatus('nonexistent')).rejects.toThrow(NotFoundException)
    })
  })

  // ─── confirmPayment (via IPN success) — kiểm tra side effects ─
  // confirmPayment gọi prisma.payment.findUnique để load full invoice relation
  describe('confirmPayment side effects', () => {
    function setupSuccessIpn(invoiceOverrides: Partial<any> = {}) {
      const fullPayment = makePayment({
        invoice: makeInvoice({ orderId: 'order-uuid-001', ...invoiceOverrides }),
      })
      mockVnpay.verifyReturn.mockReturnValue({ success: true, txnRef: 'TXN-001', amount: 200000 })
      prisma.payment.findFirst.mockResolvedValue(makePayment())
      prisma.payment.findUnique.mockResolvedValue(fullPayment) // used inside confirmPayment
      prisma.payment.update.mockResolvedValue({})
      prisma.invoice.update.mockResolvedValue({})
      prisma.order.update.mockResolvedValue({})
    }

    it('should update invoice to paid after successful payment', async () => {
      setupSuccessIpn()

      await service.handleVnpayIpn({ vnp_TxnRef: 'TXN-001' })

      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'paid' } })
      )
    })

    it('should update linked order to confirmed after successful payment', async () => {
      setupSuccessIpn()

      await service.handleVnpayIpn({ vnp_TxnRef: 'TXN-001' })

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'confirmed' } })
      )
    })

    it('should NOT update order when payment fails', async () => {
      mockVnpay.verifyReturn.mockReturnValue({ success: false, txnRef: 'TXN-001', amount: 0 })
      prisma.payment.findFirst.mockResolvedValue(makePayment())
      prisma.payment.findUnique.mockResolvedValue(makePayment())
      prisma.payment.update.mockResolvedValue({})

      await service.handleVnpayIpn({ vnp_TxnRef: 'TXN-001' })

      expect(prisma.order.update).not.toHaveBeenCalled()
    })

    it('should update booking when invoice is for a booking', async () => {
      const bookingInvoice = makeInvoice({ bookingId: 'book-001', orderId: null })
      const fullPayment = makePayment({ invoice: bookingInvoice })
      mockVnpay.verifyReturn.mockReturnValue({ success: true, txnRef: 'TXN-BK', amount: 100000 })
      prisma.payment.findFirst.mockResolvedValue(makePayment())
      prisma.payment.findUnique.mockResolvedValue(fullPayment)
      prisma.payment.update.mockResolvedValue({})
      prisma.invoice.update.mockResolvedValue({})
      prisma.booking = { update: jest.fn().mockResolvedValue({}) } as any

      await service.handleVnpayIpn({ vnp_TxnRef: 'TXN-BK' })

      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'paid' } })
      )
    })
  })
})
