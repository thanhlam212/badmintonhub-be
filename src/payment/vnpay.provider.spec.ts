import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'
import * as qs from 'qs'
import { VnpayProvider } from './vnpay.provider'

const FAKE_TMN     = 'TESTCODE'
const FAKE_SECRET  = 'fakehashsecret123'
const FAKE_URL     = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'
const FAKE_RETURN  = 'http://localhost:3000/payment/vnpay/return'

function makeProvider(overrides: Record<string, string> = {}): VnpayProvider {
  const config = {
    get: (key: string, def = '') =>
      ({
        VNPAY_TMN_CODE:    FAKE_TMN,
        VNPAY_HASH_SECRET: FAKE_SECRET,
        VNPAY_URL:         FAKE_URL,
        VNPAY_RETURN_URL:  FAKE_RETURN,
        ...overrides,
      }[key] ?? def),
  } as unknown as ConfigService

  return new VnpayProvider(config)
}

// Helper: compute expected hash for a param set
function computeHash(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params).sort().reduce((acc, k) => { acc[k] = params[k]; return acc }, {} as Record<string, string>)
  const data = qs.stringify(sorted, { encode: false })
  return crypto.createHmac('sha512', secret).update(Buffer.from(data, 'utf-8')).digest('hex')
}

describe('VnpayProvider', () => {
  let provider: VnpayProvider

  beforeEach(() => {
    provider = makeProvider()
  })

  // ── createPaymentUrl ────────────────────────────────────────
  describe('createPaymentUrl', () => {
    const baseParams = {
      txnRef:    'TXN-001',
      amount:    100000,
      orderInfo: 'Test payment',
      ipAddr:    '127.0.0.1',
    }

    it('should return a URL pointing to the VNPay gateway', () => {
      const url = provider.createPaymentUrl(baseParams)
      expect(url.startsWith(FAKE_URL)).toBe(true)
    })

    it('should include required VNPay query parameters', () => {
      const url = provider.createPaymentUrl(baseParams)
      const queryStr = url.split('?')[1]
      const parsed = qs.parse(queryStr)

      expect(parsed.vnp_TmnCode).toBe(FAKE_TMN)
      expect(parsed.vnp_TxnRef).toBe('TXN-001')
      expect(parsed.vnp_ReturnUrl).toBe(FAKE_RETURN)
      expect(parsed.vnp_CurrCode).toBe('VND')
      expect(parsed.vnp_Command).toBe('pay')
      expect(parsed.vnp_Version).toBe('2.1.0')
    })

    it('should encode amount as value * 100', () => {
      const url = provider.createPaymentUrl(baseParams)
      const parsed = qs.parse(url.split('?')[1])
      expect(Number(parsed.vnp_Amount)).toBe(100000 * 100)
    })

    it('should include a valid HMAC-SHA512 secure hash', () => {
      const url = provider.createPaymentUrl(baseParams)
      const queryStr = url.split('?')[1]
      const parsed = qs.parse(queryStr) as Record<string, string>

      const { vnp_SecureHash, ...rest } = parsed
      const expectedHash = computeHash(rest, FAKE_SECRET)
      expect(vnp_SecureHash).toBe(expectedHash)
    })

    it('should default locale to vn when not provided', () => {
      const url = provider.createPaymentUrl(baseParams)
      const parsed = qs.parse(url.split('?')[1])
      expect(parsed.vnp_Locale).toBe('vn')
    })

    it('should use provided locale when specified', () => {
      const url = provider.createPaymentUrl({ ...baseParams, locale: 'en' })
      const parsed = qs.parse(url.split('?')[1])
      expect(parsed.vnp_Locale).toBe('en')
    })
  })

  // ── verifyReturn ────────────────────────────────────────────
  describe('verifyReturn', () => {
    function buildValidQuery(responseCode = '00'): Record<string, string> {
      const params: Record<string, string> = {
        vnp_TmnCode:      FAKE_TMN,
        vnp_Amount:       '5000000',
        vnp_BankCode:     'NCB',
        vnp_OrderInfo:    'Test',
        vnp_ResponseCode: responseCode,
        vnp_TxnRef:       'TXN-123',
        vnp_TransactionNo: '123456',
      }
      params.vnp_SecureHash = computeHash(params, FAKE_SECRET)
      return params
    }

    it('should return success=true for valid hash and response code 00', () => {
      const result = provider.verifyReturn(buildValidQuery('00'))
      expect(result.success).toBe(true)
      expect(result.txnRef).toBe('TXN-123')
      expect(result.amount).toBe(50000) // 5000000 / 100
    })

    it('should return success=false when response code is not 00', () => {
      const result = provider.verifyReturn(buildValidQuery('24')) // user cancelled
      expect(result.success).toBe(false)
    })

    it('should return success=false when hash is tampered', () => {
      const query = buildValidQuery('00')
      query.vnp_SecureHash = 'invalidhash000'
      const result = provider.verifyReturn(query)
      expect(result.success).toBe(false)
    })

    it('should return success=false when a param is tampered', () => {
      const query = buildValidQuery('00')
      query.vnp_Amount = '99999999' // tampered amount
      const result = provider.verifyReturn(query)
      expect(result.success).toBe(false)
    })
  })
})
