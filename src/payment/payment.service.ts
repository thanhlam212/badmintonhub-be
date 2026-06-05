import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { VnpayProvider } from './vnpay.provider'
import { MomoProvider } from './momo.provider'
import { SepayProvider } from './sepay.provider'
import { CreatePaymentDto } from './dto/payment.dto'
import { randomUUID } from 'crypto'
import { HOLD_EXPIRES_MINUTES, expireStaleBookingHolds } from '../bookings/booking.helpers'

@Injectable()
export class PaymentService {
  constructor(
    private prisma: PrismaService,
    private vnpay: VnpayProvider,
    private momo:  MomoProvider,
    private sepay: SepayProvider,
  ) {}

  // ─── Tạo yêu cầu thanh toán ───────────────────────────────
  async createPayment(dto: CreatePaymentDto, ipAddr: string) {
    await expireStaleBookingHolds(this.prisma)

    const invoice = await this.prisma.invoice.findUnique({
      where:   { id: dto.invoiceId },
      include: { booking: true, order: true, fixedSchedule: true },
    })
    if (!invoice) throw new NotFoundException('Không tìm thấy hóa đơn')
    if (invoice.status === 'paid') throw new BadRequestException('Hóa đơn đã được thanh toán')
    if (invoice.status === 'cancelled') throw new BadRequestException('Hóa đơn đã bị hủy')

    // Kiểm tra nếu đã có payment đang pending
    await this.cancelExpiredPendingOrder(invoice)

    const existingPending = await this.prisma.payment.findFirst({
      where: { invoiceId: dto.invoiceId, status: 'pending' },
    })

    // Tạo Payment record
    const payment = await this.prisma.payment.create({
      data: {
        invoiceId:     dto.invoiceId,
        method:        dto.method,
        amount:        invoice.totalSnapshot,
        status:        'pending',
        transactionRef: existingPending
          ? existingPending.transactionRef   // reuse ref nếu đã có
          : `${dto.method.toUpperCase()}-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
      },
    })

    const amount = parseFloat(String(invoice.totalSnapshot))
    const orderInfo = this.buildOrderInfo(invoice)

    if (dto.method === 'vnpay') {
      if (!this.vnpay.isConfigured()) {
        throw new BadRequestException(
          'VNPay chưa được cấu hình. Vui lòng liên hệ quản trị viên để thiết lập VNPAY_TMN_CODE/VNPAY_HASH_SECRET/VNPAY_RETURN_URL.',
        )
      }
      const payUrl = this.vnpay.createPaymentUrl({
        txnRef:    payment.transactionRef!,
        amount,
        orderInfo,
        ipAddr,
      })
      return { paymentId: payment.id, method: 'vnpay', amount, payUrl }
    }

    if (dto.method === 'momo') {
      if (!this.momo.isConfigured()) {
        throw new BadRequestException(
          'MoMo chưa được cấu hình. Vui lòng liên hệ quản trị viên để thiết lập MOMO_PARTNER_CODE/MOMO_ACCESS_KEY/MOMO_SECRET_KEY.',
        )
      }
      const requestId = randomUUID()
      const payUrl = await this.momo.createPaymentUrl({
        orderId:   payment.transactionRef!,
        requestId,
        amount,
        orderInfo,
      })
      return { paymentId: payment.id, method: 'momo', amount, payUrl }
    }

    if (dto.method === 'sepay') {
      // Validate: at least one mode must be configured
      if (!this.sepay.isQrConfigured() && !this.sepay.isCheckoutConfigured()) {
        throw new BadRequestException(
          'SePay chưa được cấu hình. Vui lòng liên hệ quản trị viên để thiết lập SEPAY_BANK_CODE/SEPAY_ACCOUNT_NUMBER hoặc SEPAY_MERCHANT_ID/SEPAY_SECRET_KEY.',
        )
      }

      const result: Record<string, any> = {
        paymentId: payment.id,
        method: 'sepay',
        amount,
      }

      // QR mode (VietQR): requires bank code + account number
      if (this.sepay.isQrConfigured()) {
        const qr = this.sepay.createQrPayment({
          invoiceNumber: invoice.code,
          amount,
        })
        result.qrImageUrl = qr.qrImageUrl
        result.bankCode = qr.bankCode
        result.accountNumber = qr.accountNumber
        result.transferContent = qr.transferContent
      }

      // Checkout form mode: requires merchant ID + secret key
      if (this.sepay.isCheckoutConfigured()) {
        const checkout = this.sepay.createCheckoutForm({
          invoiceNumber: invoice.code,
          amount,
          description: orderInfo,
          customerId:
            invoice.booking?.userId ||
            invoice.order?.userId ||
            invoice.fixedSchedule?.userId ||
            null,
        })
        result.checkoutUrl = checkout.checkoutUrl
        result.formFields = checkout.fields
      }

      return result
    }

    throw new BadRequestException('Phương thức thanh toán không hỗ trợ: ' + dto.method)
  }

  // ─── Xử lý VNPay return URL (redirect từ gateway) ─────────
  async handleVnpayReturn(query: Record<string, string>) {
    const result = this.vnpay.verifyReturn(query)
    if (!result.txnRef) return { success: false, message: 'Thiếu mã giao dịch' }

    const payment = await this.prisma.payment.findFirst({
      where: { transactionRef: result.txnRef },
    })
    if (!payment) return { success: false, message: 'Không tìm thấy giao dịch' }

    if (payment.status === 'success') {
      return { success: true, message: 'Giao dịch đã được xử lý' }
    }

    await this.confirmPayment(payment.id, result.success, query)
    return { success: result.success, message: result.success ? 'Thanh toán thành công' : 'Thanh toán thất bại' }
  }

  // ─── Xử lý VNPay IPN (server-to-server) ───────────────────
  async handleVnpayIpn(query: Record<string, string>) {
    const result = this.vnpay.verifyReturn(query)
    if (!result.txnRef) return { RspCode: '01', Message: 'Missing txnRef' }

    const payment = await this.prisma.payment.findFirst({
      where: { transactionRef: result.txnRef },
    })
    if (!payment) return { RspCode: '01', Message: 'Order not found' }
    if (payment.status === 'success') return { RspCode: '02', Message: 'Already confirmed' }

    await this.confirmPayment(payment.id, result.success, query)
    return { RspCode: '00', Message: 'Confirm Success' }
  }

  // ─── Xử lý MoMo IPN (server-to-server) ───────────────────
  async handleMomoIpn(body: Record<string, any>) {
    const valid = this.momo.verifyIpn(body)
    if (!valid) return { resultCode: 1, message: 'Invalid signature' }

    const txnRef = String(body.orderId)
    const payment = await this.prisma.payment.findFirst({
      where: { transactionRef: txnRef },
    })
    if (!payment) return { resultCode: 1, message: 'Order not found' }
    if (payment.status === 'success') return { resultCode: 0, message: 'Already confirmed' }

    const success = body.resultCode === 0
    await this.confirmPayment(payment.id, success, body)
    return { resultCode: 0, message: 'Received' }
  }

  async handleSepayIpn(body: Record<string, any>, headers: Record<string, any>) {
    if (!this.sepay.verifyIpnSecret(headers)) {
      return { success: false, message: 'Unauthorized' }
    }

    if (!this.sepay.isPaidIpn(body)) return { success: true }

    const invoiceNumber = this.sepay.extractInvoiceNumber(body)
    if (!invoiceNumber) return { success: true }

    const invoice = await this.prisma.invoice.findUnique({
      where: { code: invoiceNumber },
    })
    if (!invoice) return { success: true }

    // Look for an existing pending payment first
    let payment = await this.prisma.payment.findFirst({
      where: { method: 'sepay', invoiceId: invoice.id, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    })
    // If no pending payment, check if already confirmed (idempotent)
    if (!payment) {
      const existing = await this.prisma.payment.findFirst({
        where: { method: 'sepay', invoiceId: invoice.id, status: 'success' },
      })
      if (existing) return { success: true }

      // Create a new pending payment (covers both first-time and retry-after-failed)
      payment = await this.prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          method: 'sepay',
          amount: invoice.totalSnapshot,
          status: 'pending',
          transactionRef: `SEPAY-${body?.id || body?.referenceCode || Date.now()}`,
        },
      })
    }

    const expectedAmount = parseFloat(String(payment.amount))
    const paidAmount = this.sepay.extractPaidAmount(body)
    const success = paidAmount >= expectedAmount

    await this.confirmPayment(payment.id, success, body)
    return { success: true }
  }

  // ─── Lấy trạng thái thanh toán ────────────────────────────
  async getPaymentStatus(paymentId: string, user: any) {
    const payment = await this.prisma.payment.findUnique({
      where:   { id: paymentId },
      include: {
        invoice: {
          include: { order: true, booking: true, fixedSchedule: true },
        },
      },
    })
    if (!payment) throw new NotFoundException('Không tìm thấy giao dịch')

    // Ownership check: admin/employee xem tất cả, user chỉ xem của mình
    if (user.role !== 'admin' && user.role !== 'employee') {
      const inv = payment.invoice
      const isOwner =
        (inv.order?.userId         != null && inv.order.userId         === user.id) ||
        (inv.booking?.userId       != null && inv.booking.userId       === user.id) ||
        (inv.fixedSchedule?.userId != null && inv.fixedSchedule.userId === user.id)
      if (!isOwner) {
        throw new ForbiddenException('Bạn không có quyền xem giao dịch này')
      }
    }

    return {
      id:             payment.id,
      invoiceId:      payment.invoiceId,
      method:         payment.method,
      amount:         parseFloat(String(payment.amount)),
      status:         payment.status,
      transactionRef: payment.transactionRef,
      createdAt:      payment.createdAt,
      invoiceStatus:  payment.invoice.status,
    }
  }

  // ─── Cập nhật kết quả giao dịch + Invoice + Order/Booking ─
  private async confirmPayment(paymentId: string, success: boolean, rawResponse: any) {
    const payment = await this.prisma.payment.findUnique({
      where:   { id: paymentId },
      include: { invoice: { include: { order: true, booking: true, fixedSchedule: true } } },
    })
    if (!payment) return

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status:          success ? 'success' : 'failed',
          gatewayResponse: rawResponse,
        },
      })

      if (!success) return

      // Cập nhật Invoice → paid
      await tx.invoice.update({
        where: { id: payment.invoiceId },
        data:  { status: 'paid' },
      })

      const invoice = payment.invoice

      // Cập nhật trạng thái đơn hàng liên quan
      if (invoice.orderId) {
        await tx.order.update({
          where: { id: invoice.orderId },
          data:  { status: 'confirmed' },
        })
      }

      if (invoice.bookingId) {
        await tx.booking.update({
          where: { id: invoice.bookingId },
          data:  { status: 'confirmed' },
        })
        await tx.courtSlot.updateMany({
          where: { bookingId: invoice.bookingId },
          data:  { status: 'booked' },
        })
      }

      if (invoice.fixedScheduleId) {
        await tx.fixedSchedule.update({
          where: { id: invoice.fixedScheduleId },
          data:  { status: 'confirmed' },
        })
        await tx.booking.updateMany({
          where: { fixedScheduleId: invoice.fixedScheduleId },
          data:  { status: 'confirmed' },
        })
        await tx.courtSlot.updateMany({
          where: { booking: { fixedScheduleId: invoice.fixedScheduleId } },
          data:  { status: 'booked' },
        })
      }
    })
  }

  private buildOrderInfo(invoice: any): string {
    if (invoice.bookingId)       return `Thanh toan dat san - ${invoice.code}`
    if (invoice.fixedScheduleId) return `Thanh toan lich co dinh - ${invoice.code}`
    if (invoice.orderId)         return `Thanh toan don hang - ${invoice.code}`
    return `Thanh toan - ${invoice.code}`
  }

  private async cancelExpiredPendingOrder(invoice: any) {
    if (!invoice.orderId || invoice.status !== 'unpaid' || invoice.order?.status !== 'pending') return

    const createdAt = new Date(invoice.order?.createdAt || invoice.createdAt)
    const expiresAt = createdAt.getTime() + HOLD_EXPIRES_MINUTES * 60 * 1000
    if (Number.isNaN(createdAt.getTime()) || Date.now() <= expiresAt) return

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: invoice.orderId },
        data: { status: 'cancelled' as any },
      })
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: 'cancelled' as any },
      })
    })

    invoice.status = 'cancelled'
    throw new BadRequestException('Đơn hàng quá 10 phút chưa thanh toán nên đã bị hủy')
  }
}
