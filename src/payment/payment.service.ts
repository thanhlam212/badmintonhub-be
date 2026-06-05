import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { EmailService }  from '../email/email.service'
import { VnpayProvider } from './vnpay.provider'
import { MomoProvider } from './momo.provider'
import { CreatePaymentDto } from './dto/payment.dto'
import { randomUUID } from 'crypto'

@Injectable()
export class PaymentService {
  constructor(
    private prisma: PrismaService,
    private email:  EmailService,
    private vnpay:  VnpayProvider,
    private momo:   MomoProvider,
  ) {}

  // ─── Tạo yêu cầu thanh toán ───────────────────────────────
  async createPayment(dto: CreatePaymentDto, ipAddr: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where:   { id: dto.invoiceId },
      include: { booking: true, order: true, fixedSchedule: true },
    })
    if (!invoice) throw new NotFoundException('Không tìm thấy hóa đơn')
    if (invoice.status === 'paid') throw new BadRequestException('Hóa đơn đã được thanh toán')
    if (invoice.status === 'cancelled') throw new BadRequestException('Hóa đơn đã bị hủy')

    // Kiểm tra nếu đã có payment đang pending
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
      const payUrl = this.vnpay.createPaymentUrl({
        txnRef:    payment.transactionRef!,
        amount,
        orderInfo,
        ipAddr,
      })
      return { paymentId: payment.id, method: 'vnpay', payUrl }
    }

    if (dto.method === 'momo') {
      const requestId = randomUUID()
      const payUrl = await this.momo.createPaymentUrl({
        orderId:   payment.transactionRef!,
        requestId,
        amount,
        orderInfo,
      })
      return { paymentId: payment.id, method: 'momo', payUrl }
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
        // Update slots: hold → booked
        await tx.courtSlot.updateMany({
          where:  { bookingId: invoice.bookingId },
          data:   { status: 'booked' },
        })
      }

      if (invoice.fixedScheduleId) {
        await tx.fixedSchedule.update({
          where: { id: invoice.fixedScheduleId },
          data:  { status: 'confirmed' },
        })
      }
    })

    // ── Gửi email xác nhận kèm QR sau khi payment gateway confirm ──
    if (success && payment.invoice.bookingId) {
      this.sendBookingConfirmedEmail(payment.invoice.bookingId).catch(() => {})
    }
  }

  // ── Gửi email xác nhận đặt sân kèm QR ──────────────────────────
  private async sendBookingConfirmedEmail(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where:   { id: bookingId },
      include: {
        court:   { include: { branch: { select: { name: true } } } },
        invoices: { select: { code: true }, take: 1 },
      },
    })
    if (!booking) return
    const email = booking.customerEmail
    if (!email) return

    await this.email.sendBookingConfirmed({
      id:            booking.id,
      customerName:  booking.customerName,
      customerEmail: email,
      courtName:     booking.court.name,
      branchName:    booking.court.branch?.name ?? '',
      bookingDate:   booking.bookingDate.toISOString(),
      timeStart:     booking.timeStart ?? '',
      timeEnd:       booking.timeEnd  ?? '',
      amount:        parseFloat(String(booking.amount)),
      invoiceCode:   booking.invoices[0]?.code,
      paymentMethod: booking.paymentMethod,
    })
  }

  private buildOrderInfo(invoice: any): string {
    if (invoice.bookingId)       return `Thanh toan dat san - ${invoice.code}`
    if (invoice.fixedScheduleId) return `Thanh toan lich co dinh - ${invoice.code}`
    if (invoice.orderId)         return `Thanh toan don hang - ${invoice.code}`
    return `Thanh toan - ${invoice.code}`
  }
}
