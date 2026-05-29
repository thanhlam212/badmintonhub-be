import { Test, TestingModule } from '@nestjs/testing'
import { PaymentController } from './payment.controller'
import { PaymentService } from './payment.service'

const mockPaymentService = {
  createPayment:     jest.fn(),
  handleVnpayReturn: jest.fn(),
  handleVnpayIpn:    jest.fn(),
  handleMomoIpn:     jest.fn(),
  getPaymentStatus:  jest.fn(),
}

describe('PaymentController', () => {
  let controller: PaymentController

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [{ provide: PaymentService, useValue: mockPaymentService }],
    }).compile()

    controller = module.get<PaymentController>(PaymentController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('create', () => {
    it('should call createPayment with dto and client IP', async () => {
      const dto = { invoiceId: 'inv-001', method: 'vnpay' as const }
      const fakeReq = { ip: '192.168.1.1', headers: {} }
      mockPaymentService.createPayment.mockResolvedValue({ paymentId: 'pay-001', payUrl: 'https://vnpay.vn' })

      const result = await controller.create(dto, fakeReq)

      expect(mockPaymentService.createPayment).toHaveBeenCalledWith(dto, '192.168.1.1')
      expect(result.payUrl).toContain('vnpay.vn')
    })

    it('should use X-Forwarded-For header when req.ip is absent', async () => {
      const dto = { invoiceId: 'inv-001', method: 'momo' as const }
      const fakeReq = { ip: undefined, headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' } }
      mockPaymentService.createPayment.mockResolvedValue({ paymentId: 'pay-002', payUrl: 'https://momo.vn' })

      await controller.create(dto, fakeReq)

      // Should use the first IP from x-forwarded-for
      expect(mockPaymentService.createPayment).toHaveBeenCalledWith(dto, '10.0.0.1')
    })
  })

  describe('vnpayReturn', () => {
    it('should delegate to handleVnpayReturn with query params', async () => {
      const query = { vnp_TxnRef: 'TXN-001', vnp_ResponseCode: '00', vnp_SecureHash: 'abc' }
      mockPaymentService.handleVnpayReturn.mockResolvedValue({ success: true, message: 'OK' })

      const result = await controller.vnpayReturn(query)

      expect(mockPaymentService.handleVnpayReturn).toHaveBeenCalledWith(query)
      expect(result.success).toBe(true)
    })
  })

  describe('vnpayIpn', () => {
    it('should delegate to handleVnpayIpn and return RspCode', async () => {
      const query = { vnp_TxnRef: 'TXN-001', vnp_SecureHash: 'abc' }
      mockPaymentService.handleVnpayIpn.mockResolvedValue({ RspCode: '00', Message: 'Confirm Success' })

      const result = await controller.vnpayIpn(query)

      expect(result.RspCode).toBe('00')
    })
  })

  describe('momoIpn', () => {
    it('should delegate to handleMomoIpn and return resultCode', async () => {
      const body = { orderId: 'TXN-001', resultCode: 0, signature: 'valid' }
      mockPaymentService.handleMomoIpn.mockResolvedValue({ resultCode: 0, message: 'Received' })

      const result = await controller.momoIpn(body)

      expect(result.resultCode).toBe(0)
    })
  })

  describe('getStatus', () => {
    it('should return payment status by id', async () => {
      const fakeUser = { id: 'user-001', role: 'admin' }
      mockPaymentService.getPaymentStatus.mockResolvedValue({
        id: 'pay-001', status: 'success', amount: 200000,
      })

      const result = await controller.getStatus('pay-001', fakeUser)

      expect(mockPaymentService.getPaymentStatus).toHaveBeenCalledWith('pay-001', fakeUser)
      expect(result.status).toBe('success')
    })
  })
})
