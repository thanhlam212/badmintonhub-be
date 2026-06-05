import { ConfigService } from '@nestjs/config'
import { SepayProvider } from './sepay.provider'
import * as crypto from 'crypto'

function makeProvider(overrides: Record<string, string> = {}): SepayProvider {
  const config = {
    get: (key: string, def = '') =>
      ({
        SEPAY_ENV: 'sandbox',
        SEPAY_MERCHANT_ID: 'MERCHANT',
        SEPAY_SECRET_KEY: 'secret',
        SEPAY_WEBHOOK_SECRET: 'webhook-secret',
        SEPAY_APP_URL: 'http://localhost:3000',
        SEPAY_BANK_CODE: 'VCB',
        SEPAY_ACCOUNT_NUMBER: '123456789',
        ...overrides,
      }[key] ?? def),
  } as unknown as ConfigService

  return new SepayProvider(config)
}

describe('SepayProvider', () => {
  let provider: SepayProvider

  beforeEach(() => {
    provider = makeProvider()
  })

  describe('extractInvoiceNumber', () => {
    it('should use a direct invoice code when the code field contains one', () => {
      expect(provider.extractInvoiceNumber({ code: 'BK-20260602-1234' })).toBe('BK-20260602-1234')
      expect(provider.extractInvoiceNumber({ code: 'SO-20260602-1234' })).toBe('SO-20260602-1234')
    })

    it('should ignore SePay transaction codes and find the invoice code in transfer content', () => {
      const invoiceNumber = provider.extractInvoiceNumber({
        code: 'MBVCB123456',
        content: 'Thanh toan dat san BK-20260602-1234',
        transferType: 'in',
        transferAmount: 200000,
      })

      expect(invoiceNumber).toBe('BK-20260602-1234')
    })

    it('should return an empty string when no invoice code is present', () => {
      expect(provider.extractInvoiceNumber({ code: 'MBVCB123456', content: 'random transfer' })).toBe('')
    })
  })

  describe('createQrPayment', () => {
    it('should include amount and transfer content in the VietQR URL', () => {
      const qr = provider.createQrPayment({ invoiceNumber: 'BK-20260602-1234', amount: 200000 })

      expect(qr.qrImageUrl).toContain('amount=200000')
      expect(qr.qrImageUrl).toContain('des=BK-20260602-1234')
      expect(qr.transferContent).toBe('BK-20260602-1234')
    })
  })

  describe('createCheckoutForm', () => {
    it('should use sandbox URL by default and generate correct fields', () => {
      const checkout = provider.createCheckoutForm({
        invoiceNumber: 'BK-20260602-1234',
        amount: 200000,
        description: 'Test checkout',
      })

      expect(checkout.checkoutUrl).toBe('https://pay-sandbox.sepay.vn/v1/checkout/init')
      expect(checkout.fields.order_amount).toBe('200000')
      expect(checkout.fields.merchant).toBe('MERCHANT')
      expect(checkout.fields.order_invoice_number).toBe('BK-20260602-1234')
      expect(checkout.fields.signature).toBeDefined()
    })

    it('should generate signature using the correct field order', () => {
      const checkout = provider.createCheckoutForm({
        invoiceNumber: 'BK-20260602-1234',
        amount: 200000,
        description: 'Test checkout',
      })

      const expectedRawString = [
        'order_amount=200000',
        'currency=VND',
        'order_invoice_number=BK-20260602-1234',
        'order_description=Test checkout',
        'customer_id=',
        'payment_method=BANK_TRANSFER',
        'success_url=http://localhost:3000/booking/success',
        'error_url=http://localhost:3000/booking',
        'cancel_url=http://localhost:3000/booking',
        'merchant=MERCHANT',
        'operation=PURCHASE',
      ].join(',')

      const expectedSignature = crypto
        .createHmac('sha256', 'secret')
        .update(expectedRawString)
        .digest('base64')

      expect(checkout.fields.signature).toBe(expectedSignature)
    })

    it('should use production URL when configured in live mode', () => {
      const liveProvider = makeProvider({ SEPAY_ENV: 'production' })
      const checkout = liveProvider.createCheckoutForm({
        invoiceNumber: 'BK-20260602-1234',
        amount: 200000,
        description: 'Live checkout',
      })

      expect(checkout.checkoutUrl).toBe('https://pay.sepay.vn/v1/checkout/init')
    })
  })

  // ─── verifyIpnSecret ──────────────────────────────────────────

  describe('verifyIpnSecret', () => {
    it('should accept valid Apikey authorization header', () => {
      expect(provider.verifyIpnSecret({ authorization: 'Apikey webhook-secret' })).toBe(true)
    })

    it('should accept valid Authorization header (capital A)', () => {
      expect(provider.verifyIpnSecret({ Authorization: 'Apikey webhook-secret' })).toBe(true)
    })

    it('should accept legacy x-secret-key header', () => {
      expect(provider.verifyIpnSecret({ 'x-secret-key': 'webhook-secret' })).toBe(true)
    })

    it('should reject invalid Apikey', () => {
      expect(provider.verifyIpnSecret({ authorization: 'Apikey wrong-key' })).toBe(false)
    })

    it('should reject empty headers', () => {
      expect(provider.verifyIpnSecret({})).toBe(false)
    })

    it('should return true when webhook secret is not configured', () => {
      const noSecretProvider = makeProvider({ SEPAY_WEBHOOK_SECRET: '' })
      expect(noSecretProvider.verifyIpnSecret({})).toBe(true)
    })
  })

  // ─── isPaidIpn ────────────────────────────────────────────────

  describe('isPaidIpn', () => {
    it('should return true for incoming bank transfer', () => {
      expect(provider.isPaidIpn({ transferType: 'in', transferAmount: 200000 })).toBe(true)
    })

    it('should return false for outgoing bank transfer', () => {
      expect(provider.isPaidIpn({ transferType: 'out', transferAmount: 200000 })).toBe(false)
    })

    it('should return false for zero-amount incoming transfer', () => {
      expect(provider.isPaidIpn({ transferType: 'in', transferAmount: 0 })).toBe(false)
    })

    it('should return true for checkout ORDER_PAID notification', () => {
      expect(provider.isPaidIpn({
        notification_type: 'ORDER_PAID',
        order: { order_status: 'CAPTURED' },
        transaction: { transaction_status: 'APPROVED' },
      })).toBe(true)
    })

    it('should return false for non-CAPTURED order status', () => {
      expect(provider.isPaidIpn({
        notification_type: 'ORDER_PAID',
        order: { order_status: 'PENDING' },
        transaction: { transaction_status: 'APPROVED' },
      })).toBe(false)
    })

    it('should return false for empty body', () => {
      expect(provider.isPaidIpn({})).toBe(false)
    })
  })

  // ─── extractPaidAmount ────────────────────────────────────────

  describe('extractPaidAmount', () => {
    it('should extract from transferAmount (VietQR mode)', () => {
      expect(provider.extractPaidAmount({ transferAmount: 200000 })).toBe(200000)
    })

    it('should extract from transaction.transaction_amount (checkout mode)', () => {
      expect(provider.extractPaidAmount({
        transaction: { transaction_amount: 150000 },
      })).toBe(150000)
    })

    it('should extract from order.order_amount as fallback', () => {
      expect(provider.extractPaidAmount({
        order: { order_amount: 100000 },
      })).toBe(100000)
    })

    it('should return 0 when no amount field present', () => {
      expect(provider.extractPaidAmount({})).toBe(0)
    })
  })
})
