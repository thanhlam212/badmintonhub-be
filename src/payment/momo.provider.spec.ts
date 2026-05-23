import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'
import axios from 'axios'
import { MomoProvider } from './momo.provider'

jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

const FAKE = {
  MOMO_PARTNER_CODE: 'TESTPARTNER',
  MOMO_ACCESS_KEY:   'testAccessKey',
  MOMO_SECRET_KEY:   'testSecretKey',
  MOMO_API_URL:      'https://test-payment.momo.vn/v2/gateway/api/create',
  MOMO_REDIRECT_URL: 'http://localhost:3000/payment/momo/return',
  MOMO_IPN_URL:      'https://myserver.com/api/payment/momo/ipn',
}

function makeProvider(): MomoProvider {
  const config = { get: (key: string, def = '') => FAKE[key] ?? def } as unknown as ConfigService
  return new MomoProvider(config)
}

// Build valid IPN body + compute correct HMAC-SHA256
function buildIpnBody(overrides: Record<string, any> = {}): Record<string, any> {
  const body: Record<string, any> = {
    partnerCode: FAKE.MOMO_PARTNER_CODE,
    orderId:     'TXN-001',
    requestId:   'REQ-001',
    amount:      100000,
    resultCode:  0,
    message:     'Successful.',
    ...overrides,
  }
  const keys = Object.keys(body).filter(k => k !== 'signature').sort()
  const raw = keys.map(k => `${k}=${body[k]}`).join('&')
  body.signature = crypto.createHmac('sha256', FAKE.MOMO_SECRET_KEY).update(raw).digest('hex')
  return body
}

describe('MomoProvider', () => {
  let provider: MomoProvider

  beforeEach(() => {
    provider = makeProvider()
    jest.clearAllMocks()
  })

  // ── createPaymentUrl ────────────────────────────────────────
  describe('createPaymentUrl', () => {
    it('should return payUrl from MoMo API on success', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { resultCode: 0, payUrl: 'https://momo.vn/pay/test' },
      })

      const url = await provider.createPaymentUrl({
        orderId:   'ORD-001',
        requestId: 'REQ-001',
        amount:    100000,
        orderInfo: 'Test payment',
      })

      expect(url).toBe('https://momo.vn/pay/test')
    })

    it('should call MoMo API with correct body fields', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { resultCode: 0, payUrl: 'https://momo.vn/pay/test' },
      })

      await provider.createPaymentUrl({
        orderId:   'ORD-001',
        requestId: 'REQ-001',
        amount:    50000,
        orderInfo: 'Dat san',
      })

      const [url, body] = (mockedAxios.post as jest.Mock).mock.calls[0]
      expect(url).toBe(FAKE.MOMO_API_URL)
      expect(body.partnerCode).toBe(FAKE.MOMO_PARTNER_CODE)
      expect(body.amount).toBe(50000)
      expect(body.orderId).toBe('ORD-001')
      expect(body.redirectUrl).toBe(FAKE.MOMO_REDIRECT_URL)
      expect(body.ipnUrl).toBe(FAKE.MOMO_IPN_URL)
      expect(body.signature).toBeTruthy()
    })

    it('should throw when MoMo API returns non-zero resultCode', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({
        data: { resultCode: 11, message: 'Access denied' },
      })

      await expect(
        provider.createPaymentUrl({ orderId: 'X', requestId: 'Y', amount: 1000, orderInfo: 'Z' })
      ).rejects.toThrow('MoMo error: Access denied')
    })
  })

  // ── verifyIpn ───────────────────────────────────────────────
  describe('verifyIpn', () => {
    it('should return true for a valid IPN signature', () => {
      const body = buildIpnBody()
      expect(provider.verifyIpn(body)).toBe(true)
    })

    it('should return false when signature is tampered', () => {
      const body = buildIpnBody()
      body.signature = 'invalidsignature000'
      expect(provider.verifyIpn(body)).toBe(false)
    })

    it('should return false when a payload field is modified after signing', () => {
      const body = buildIpnBody()
      body.amount = 999999 // tampered after signature generated
      expect(provider.verifyIpn(body)).toBe(false)
    })

    it('should return true regardless of resultCode value (only signature matters)', () => {
      const failBody = buildIpnBody({ resultCode: 1001 }) // failed payment but valid sig
      expect(provider.verifyIpn(failBody)).toBe(true)
    })
  })
})
