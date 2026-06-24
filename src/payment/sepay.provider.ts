import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'

type SepayCheckoutField =
  | 'order_amount'
  | 'merchant'
  | 'currency'
  | 'operation'
  | 'order_description'
  | 'order_invoice_number'
  | 'customer_id'
  | 'payment_method'
  | 'success_url'
  | 'error_url'
  | 'cancel_url'

export interface SepayCheckoutForm {
  checkoutUrl: string
  fields: Record<SepayCheckoutField | 'signature', string>
}

export interface SepayQrPayment {
  qrImageUrl: string | null
  bankCode: string
  accountNumber: string
  transferContent: string
}

@Injectable()
export class SepayProvider {
  private readonly merchantId: string
  private readonly secretKey: string
  private readonly webhookSecret: string
  private readonly checkoutUrl: string
  private readonly appBaseUrl: string
  private readonly successUrl: string
  private readonly errorUrl: string
  private readonly cancelUrl: string
  private readonly paymentMethod: string
  private readonly bankCode: string
  private readonly accountNumber: string
  private readonly qrTemplate: string
  private readonly invoiceCodePattern = /\b(?:MB|BK|FS|OD|SO)-\d{8}-\d{4}\b/i

  constructor(private config: ConfigService) {
    const env = String(config.get<string>('SEPAY_ENV', 'sandbox') || 'sandbox').toLowerCase()
    this.merchantId = config.get<string>('SEPAY_MERCHANT_ID', '')
    this.secretKey = config.get<string>('SEPAY_SECRET_KEY', '')
    this.webhookSecret = config.get<string>('SEPAY_WEBHOOK_SECRET', this.secretKey)
    this.appBaseUrl = config.get<string>('SEPAY_APP_URL', '')
    this.checkoutUrl = config.get<string>(
      'SEPAY_CHECKOUT_URL',
      this.resolveCheckoutUrl(env),
    )
    this.successUrl = this.resolveCallbackUrl(
      config.get<string>('SEPAY_SUCCESS_URL', ''),
      '/booking/success',
    )
    this.errorUrl = this.resolveCallbackUrl(
      config.get<string>('SEPAY_ERROR_URL', ''),
      '/booking',
    )
    this.cancelUrl = this.resolveCallbackUrl(
      config.get<string>('SEPAY_CANCEL_URL', ''),
      '/booking',
    )
    this.paymentMethod = config.get<string>('SEPAY_PAYMENT_METHOD', 'BANK_TRANSFER')
    this.bankCode = config.get<string>('SEPAY_BANK_CODE', '')
    this.accountNumber = config.get<string>('SEPAY_ACCOUNT_NUMBER', '')
    this.qrTemplate = config.get<string>('SEPAY_QR_TEMPLATE', 'compact')
  }

  /** Check if SePay Checkout API is configured (merchant + secret key) */
  isCheckoutConfigured(): boolean {
    return Boolean(
      this.merchantId &&
      this.secretKey &&
      this.checkoutUrl &&
      this.successUrl &&
      this.errorUrl &&
      this.cancelUrl,
    )
  }

  /** Check if VietQR mode is configured (bank code + account number) */
  isQrConfigured(): boolean {
    return Boolean(this.bankCode && this.accountNumber)
  }

  createCheckoutForm(params: {
    invoiceNumber: string
    amount: number
    description: string
    customerId?: string | null
  }): SepayCheckoutForm {
    if (!this.isCheckoutConfigured()) {
      throw new Error('SePay checkout chưa được cấu hình đầy đủ')
    }

    const fields: Record<string, string> = {
      order_amount: String(Math.round(params.amount)),
      currency: 'VND',
      order_invoice_number: params.invoiceNumber,
      order_description: params.description,
      customer_id: params.customerId || '',
      payment_method: this.paymentMethod,
      success_url: this.successUrl,
      error_url: this.errorUrl,
      cancel_url: this.cancelUrl,
      merchant: this.merchantId,
      operation: 'PURCHASE',
    }

    return {
      checkoutUrl: this.checkoutUrl,
      fields: {
        ...fields,
        signature: this.signFields(fields),
      } as Record<SepayCheckoutField | 'signature', string>,
    }
  }

  createQrPayment(params: {
    invoiceNumber: string
    amount: number
  }): SepayQrPayment {
    const transferContent = params.invoiceNumber
    const hasQrConfig = Boolean(this.bankCode && this.accountNumber)
    const query = new URLSearchParams({
      acc: this.accountNumber,
      bank: this.bankCode,
      amount: String(Math.round(params.amount)),
      des: transferContent,
    })
    if (this.qrTemplate) query.set('template', this.qrTemplate)

    return {
      qrImageUrl: hasQrConfig ? `https://qr.sepay.vn/img?${query.toString()}` : null,
      bankCode: this.bankCode,
      accountNumber: this.accountNumber,
      transferContent,
    }
  }

  verifyIpnSecret(headers: Record<string, any>): boolean {
    const expected = this.webhookSecret
    if (!expected) return true
    const authorization = String(headers.authorization || headers.Authorization || '')
    const apiKey = authorization.match(/^Apikey\s+(.+)$/i)?.[1]
    const legacySecret = String(headers['x-secret-key'] || headers['X-Secret-Key'] || '')
    return (apiKey || legacySecret) === expected
  }

  isPaidIpn(body: Record<string, any>): boolean {
    if (body?.transferType) {
      return body.transferType === 'in' && Number(body.transferAmount || 0) > 0
    }

    return (
      body?.notification_type === 'ORDER_PAID' &&
      body?.order?.order_status === 'CAPTURED' &&
      body?.transaction?.transaction_status === 'APPROVED'
    )
  }

  extractInvoiceNumber(body: Record<string, any>): string {
    const directCode = String(body?.order?.order_invoice_number || body?.code || '').trim()
    const directMatch = directCode.match(this.invoiceCodePattern)
    if (directMatch) return directMatch[0].toUpperCase()

    const searchable = [
      body?.code,
      body?.content,
      body?.description,
      body?.order?.order_invoice_number,
      body?.transaction?.transaction_content,
    ].filter(Boolean).join(' ')

    const match = searchable.match(this.invoiceCodePattern)
    return match?.[0]?.toUpperCase() || ''
  }

  extractPaidAmount(body: Record<string, any>): number {
    return Number(
      body?.transferAmount ||
      body?.transaction?.transaction_amount ||
      body?.order?.order_amount ||
      0,
    )
  }

  private resolveCheckoutUrl(env: string): string {
    if (env === 'production' || env === 'live') {
      return 'https://pay.sepay.vn/v1/checkout/init'
    }

    return 'https://pay-sandbox.sepay.vn/v1/checkout/init'
  }

  private resolveCallbackUrl(explicitUrl: string, path: string): string {
    if (explicitUrl) return explicitUrl
    if (!this.appBaseUrl) return ''

    return `${this.appBaseUrl.replace(/\/$/, '')}${path}`
  }

  private signFields(fields: Record<string, string>): string {
    const signed: string[] = []
    const signedFieldsList = [
      'merchant',
      'env',
      'operation',
      'payment_method',
      'order_amount',
      'currency',
      'order_invoice_number',
      'order_description',
      'customer_id',
      'agreement_id',
      'agreement_name',
      'agreement_type',
      'agreement_payment_frequency',
      'agreement_amount_per_payment',
      'success_url',
      'error_url',
      'cancel_url',
      'order_id',
    ]

    const signedFields = Object.keys(fields).filter((field) =>
      signedFieldsList.includes(field),
    )

    for (const field of signedFields) {
      if (fields[field] === undefined) continue
      signed.push(`${field}=${fields[field] ?? ''}`)
    }

    return crypto
      .createHmac('sha256', this.secretKey)
      .update(signed.join(','))
      .digest('base64')
  }
}
