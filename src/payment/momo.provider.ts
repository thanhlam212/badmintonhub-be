import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'
import axios from 'axios'

@Injectable()
export class MomoProvider {
  private readonly partnerCode: string
  private readonly accessKey: string
  private readonly secretKey: string
  private readonly apiUrl: string
  private readonly redirectUrl: string
  private readonly ipnUrl: string

  constructor(private config: ConfigService) {
    this.partnerCode = config.get<string>('MOMO_PARTNER_CODE', '')
    this.accessKey   = config.get<string>('MOMO_ACCESS_KEY', '')
    this.secretKey   = config.get<string>('MOMO_SECRET_KEY', '')
    this.apiUrl      = config.get<string>('MOMO_API_URL', 'https://test-payment.momo.vn/v2/gateway/api/create')
    this.redirectUrl = config.get<string>('MOMO_REDIRECT_URL', '')
    this.ipnUrl      = config.get<string>('MOMO_IPN_URL', '')
  }

  async createPaymentUrl(params: {
    orderId: string
    requestId: string
    amount: number
    orderInfo: string
    extraData?: string
  }): Promise<string> {
    const rawSignature =
      `accessKey=${this.accessKey}` +
      `&amount=${params.amount}` +
      `&extraData=${params.extraData ?? ''}` +
      `&ipnUrl=${this.ipnUrl}` +
      `&orderId=${params.orderId}` +
      `&orderInfo=${params.orderInfo}` +
      `&partnerCode=${this.partnerCode}` +
      `&redirectUrl=${this.redirectUrl}` +
      `&requestId=${params.requestId}` +
      `&requestType=payWithMethod`

    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(rawSignature)
      .digest('hex')

    const body = {
      partnerCode: this.partnerCode,
      accessKey:   this.accessKey,
      requestId:   params.requestId,
      amount:      params.amount,
      orderId:     params.orderId,
      orderInfo:   params.orderInfo,
      redirectUrl: this.redirectUrl,
      ipnUrl:      this.ipnUrl,
      extraData:   params.extraData ?? '',
      requestType: 'payWithMethod',
      lang:        'vi',
      signature,
    }

    const res = await axios.post(this.apiUrl, body)
    if (res.data.resultCode !== 0) {
      throw new Error(`MoMo error: ${res.data.message}`)
    }
    return res.data.payUrl as string
  }

  verifyIpn(body: Record<string, any>): boolean {
    const { signature, ...rest } = body
    const keys = Object.keys(rest).sort()
    const rawSignature = keys.map(k => `${k}=${rest[k]}`).join('&')
    const expected = crypto
      .createHmac('sha256', this.secretKey)
      .update(rawSignature)
      .digest('hex')
    return expected === signature
  }
}
