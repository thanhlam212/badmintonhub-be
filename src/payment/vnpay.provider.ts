import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'
import * as qs from 'qs'

@Injectable()
export class VnpayProvider {
  private readonly tmnCode: string
  private readonly hashSecret: string
  private readonly paymentUrl: string
  private readonly returnUrl: string

  constructor(private config: ConfigService) {
    this.tmnCode    = config.get<string>('VNPAY_TMN_CODE', '')
    this.hashSecret = config.get<string>('VNPAY_HASH_SECRET', '')
    this.paymentUrl = config.get<string>('VNPAY_URL', 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html')
    this.returnUrl  = config.get<string>('VNPAY_RETURN_URL', '')
  }

  createPaymentUrl(params: {
    txnRef: string
    amount: number
    orderInfo: string
    ipAddr: string
    locale?: string
  }): string {
    const date = new Date()
    const createDate = this.formatDate(date)
    const expireDate = this.formatDate(new Date(date.getTime() + 15 * 60 * 1000))

    const vnpParams: Record<string, string> = {
      vnp_Version:    '2.1.0',
      vnp_Command:    'pay',
      vnp_TmnCode:    this.tmnCode,
      vnp_Locale:     params.locale ?? 'vn',
      vnp_CurrCode:   'VND',
      vnp_TxnRef:     params.txnRef,
      vnp_OrderInfo:  params.orderInfo,
      vnp_OrderType:  'other',
      vnp_Amount:     String(params.amount * 100),
      vnp_ReturnUrl:  this.returnUrl,
      vnp_IpAddr:     params.ipAddr,
      vnp_CreateDate: createDate,
      vnp_ExpireDate: expireDate,
    }

    const sorted = this.sortObject(vnpParams)
    const signData = qs.stringify(sorted, { encode: false })
    const hmac = crypto.createHmac('sha512', this.hashSecret)
    const secureHash = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex')

    return `${this.paymentUrl}?${signData}&vnp_SecureHash=${secureHash}`
  }

  verifyReturn(query: Record<string, string>): { success: boolean; txnRef: string; amount: number } {
    const { vnp_SecureHash, vnp_SecureHashType, ...params } = query
    const sorted = this.sortObject(params)
    const signData = qs.stringify(sorted, { encode: false })
    const hmac = crypto.createHmac('sha512', this.hashSecret)
    const checkHash = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex')

    return {
      success: checkHash === vnp_SecureHash && params.vnp_ResponseCode === '00',
      txnRef:  params.vnp_TxnRef,
      amount:  parseInt(params.vnp_Amount) / 100,
    }
  }

  private sortObject(obj: Record<string, string>): Record<string, string> {
    return Object.keys(obj)
      .sort()
      .reduce((acc, key) => { acc[key] = obj[key]; return acc }, {} as Record<string, string>)
  }

  private formatDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return (
      d.getFullYear().toString() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds())
    )
  }
}
