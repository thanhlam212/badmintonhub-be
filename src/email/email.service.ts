// src/email/email.service.ts
import { Injectable, Logger } from '@nestjs/common'
import * as nodemailer from 'nodemailer'

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)
  private transporter: nodemailer.Transporter
  private frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.MAIL_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    })
  }

  // ─── Gửi email xác nhận đặt sân (kèm QR check-in) ────────────
  async sendBookingConfirmed(booking: {
    id: string
    customerName: string
    customerEmail: string
    courtName: string
    branchName: string
    bookingDate: string
    timeStart: string
    timeEnd: string
    amount: number
    invoiceCode?: string
    paymentMethod?: string
  }) {
    if (!booking.customerEmail) return

    const dateStr = new Date(booking.bookingDate).toLocaleDateString('vi-VN', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    })

    const amountStr = new Intl.NumberFormat('vi-VN').format(booking.amount)
    const payMethodLabel = this.payMethodLabel(booking.paymentMethod)

    // QR code chứa booking UUID để nhân viên quét check-in
    const qrData   = encodeURIComponent(booking.id)
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${qrData}&color=0a2416&bgcolor=ffffff`

    const html = `
<!DOCTYPE html>
<html lang="vi">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#0a2416 0%,#1a5c32 100%);padding:28px 32px;text-align:center;">
          <p style="margin:0;color:#86efac;font-size:12px;letter-spacing:2px;text-transform:uppercase;">BadmintonHub</p>
          <h1 style="margin:8px 0 0;color:#ffffff;font-size:26px;">🏸 Đặt sân thành công!</h1>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:32px;">

          <p style="margin:0 0 20px;color:#374151;font-size:16px;">
            Xin chào <strong>${booking.customerName}</strong>, đặt sân của bạn đã được xác nhận!
          </p>

          <!-- Info box -->
          <table width="100%" cellpadding="0" cellspacing="0"
            style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:24px;">
            <tr>
              <td style="padding:6px 0;color:#6b7280;font-size:14px;width:42%;">📋 Mã đặt sân</td>
              <td style="padding:6px 0;font-weight:bold;font-family:monospace;font-size:13px;color:#166534;">${booking.id}</td>
            </tr>
            <tr style="border-top:1px solid #dcfce7;">
              <td style="padding:6px 0;color:#6b7280;font-size:14px;">🏸 Sân</td>
              <td style="padding:6px 0;font-weight:bold;font-size:14px;">${booking.courtName}</td>
            </tr>
            <tr style="border-top:1px solid #dcfce7;">
              <td style="padding:6px 0;color:#6b7280;font-size:14px;">📍 Chi nhánh</td>
              <td style="padding:6px 0;font-size:14px;">${booking.branchName}</td>
            </tr>
            <tr style="border-top:1px solid #dcfce7;">
              <td style="padding:6px 0;color:#6b7280;font-size:14px;">📅 Ngày chơi</td>
              <td style="padding:6px 0;font-weight:bold;font-size:14px;">${dateStr}</td>
            </tr>
            <tr style="border-top:1px solid #dcfce7;">
              <td style="padding:6px 0;color:#6b7280;font-size:14px;">⏰ Giờ chơi</td>
              <td style="padding:6px 0;font-weight:bold;font-size:16px;color:#16a34a;">${booking.timeStart} – ${booking.timeEnd}</td>
            </tr>
            <tr style="border-top:1px solid #dcfce7;">
              <td style="padding:6px 0;color:#6b7280;font-size:14px;">💳 Thanh toán</td>
              <td style="padding:6px 0;font-size:14px;">${payMethodLabel}</td>
            </tr>
            <tr style="border-top:1px solid #dcfce7;">
              <td style="padding:6px 0;color:#6b7280;font-size:14px;">💰 Tổng tiền</td>
              <td style="padding:6px 0;font-weight:bold;font-size:20px;color:#16a34a;">${amountStr}đ</td>
            </tr>
          </table>

          <!-- QR code section -->
          <table width="100%" cellpadding="0" cellspacing="0"
            style="background:#0a2416;border-radius:16px;padding:28px;text-align:center;margin-bottom:24px;">
            <tr>
              <td align="center">
                <p style="margin:0 0 4px;color:#86efac;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Mã QR Check-in</p>
                <p style="margin:0 0 20px;color:#d1fae5;font-size:14px;">Xuất trình khi đến sân để check-in ngay</p>
                <img
                  src="${qrApiUrl}"
                  alt="QR Check-in ${booking.id}"
                  width="180" height="180"
                  style="border:6px solid #ffffff;border-radius:12px;background:#ffffff;display:block;margin:0 auto;"
                />
                <p style="margin:16px 0 0;color:#6ee7b7;font-size:12px;font-family:monospace;">${booking.id}</p>
              </td>
            </tr>
          </table>

          <!-- How to checkin -->
          <table width="100%" cellpadding="0" cellspacing="0"
            style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px;margin-bottom:24px;">
            <tr>
              <td style="color:#1d4ed8;font-size:14px;">
                <strong>📱 Hướng dẫn check-in:</strong><br/>
                <ol style="margin:8px 0 0;padding-left:20px;line-height:1.8;">
                  <li>Lưu email này hoặc chụp ảnh mã QR ở trên</li>
                  <li>Đến sân trước giờ chơi ít nhất <strong>15 phút</strong></li>
                  <li>Xuất trình mã QR cho nhân viên quét hoặc đưa mã đặt sân</li>
                  <li>Hệ thống xác nhận → bắt đầu tính giờ chơi</li>
                  <li>Chơi xong → nhân viên ghi nhận hoàn thành</li>
                </ol>
              </td>
            </tr>
          </table>

          <!-- Note -->
          <table width="100%" cellpadding="0" cellspacing="0"
            style="background:#fefce8;border:1px solid #fef08a;border-radius:12px;padding:14px;margin-bottom:24px;">
            <tr>
              <td style="color:#854d0e;font-size:13px;">
                ⚠️ <strong>Lưu ý:</strong> Mã check-in chỉ hợp lệ đúng ngày đặt sân.
                Nếu cần hủy hoặc thay đổi, vui lòng liên hệ trước 2 tiếng.
              </td>
            </tr>
          </table>

          <p style="color:#9ca3af;font-size:13px;text-align:center;margin:0;">
            Chúc bạn có buổi chơi cầu lông thật vui vẻ! 🏸<br/>
            Mọi thắc mắc xin liên hệ hotline hoặc reply email này.
          </p>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#9ca3af;font-size:12px;">© 2025 BadmintonHub · All rights reserved</p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`

    try {
      await this.transporter.sendMail({
        from: `"BadmintonHub" <${process.env.MAIL_USER}>`,
        to: booking.customerEmail,
        subject: `🏸 [BadmintonHub] Xác nhận đặt sân ${booking.courtName} – ${dateStr}`,
        html,
      })
      this.logger.log(`✅ Email sent to ${booking.customerEmail} for booking ${booking.id}`)
    } catch (err) {
      this.logger.error(`❌ Failed to send email for booking ${booking.id}:`, err)
    }
  }

  // ─── Gửi email xác nhận đặt hàng online ─────────────────────
  async sendOrderConfirmed(order: {
    id: string
    customerName: string
    customerEmail: string
    items: { name: string; qty: number; price: number }[]
    total: number
    paymentMethod?: string
  }) {
    if (!order.customerEmail) return

    const itemRows = order.items.map(i => `
      <tr style="border-top:1px solid #f3f4f6;">
        <td style="padding:8px 0;font-size:14px;">${i.name}</td>
        <td style="padding:8px 0;text-align:center;font-size:14px;">${i.qty}</td>
        <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:bold;">
          ${new Intl.NumberFormat('vi-VN').format(i.price * i.qty)}đ
        </td>
      </tr>`).join('')

    const html = `
<!DOCTYPE html>
<html lang="vi">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="background:linear-gradient(135deg,#ea580c 0%,#f97316 100%);padding:28px 32px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;">🛒 Đặt hàng thành công!</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;">
          <p style="margin:0 0 20px;color:#374151;">Xin chào <strong>${order.customerName}</strong>, đơn hàng của bạn đã được tiếp nhận!</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:20px;">
            <tr>
              <td style="font-weight:bold;color:#6b7280;font-size:13px;">SẢN PHẨM</td>
              <td style="font-weight:bold;color:#6b7280;font-size:13px;text-align:center;">SL</td>
              <td style="font-weight:bold;color:#6b7280;font-size:13px;text-align:right;">THÀNH TIỀN</td>
            </tr>
            ${itemRows}
            <tr style="border-top:2px solid #e5e7eb;">
              <td colspan="2" style="padding:12px 0;font-weight:bold;font-size:16px;">Tổng cộng</td>
              <td style="padding:12px 0;font-weight:bold;font-size:20px;color:#ea580c;text-align:right;">
                ${new Intl.NumberFormat('vi-VN').format(order.total)}đ
              </td>
            </tr>
          </table>
          <p style="margin:0;color:#9ca3af;font-size:13px;text-align:center;">
            Nhân viên sẽ liên hệ xác nhận đơn. Cảm ơn bạn đã mua hàng tại BadmintonHub! 🏸
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`

    try {
      await this.transporter.sendMail({
        from: `"BadmintonHub" <${process.env.MAIL_USER}>`,
        to: order.customerEmail,
        subject: `🛒 [BadmintonHub] Xác nhận đơn hàng #${order.id.substring(0, 8).toUpperCase()}`,
        html,
      })
      this.logger.log(`✅ Order email sent to ${order.customerEmail}`)
    } catch (err) {
      this.logger.error(`❌ Failed to send order email:`, err)
    }
  }

  private payMethodLabel(method?: string): string {
    const map: Record<string, string> = {
      cash: '💵 Tiền mặt tại quầy',
      bank_transfer: '🏦 Chuyển khoản ngân hàng',
      vnpay: '💳 VNPay',
      momo: '📱 MoMo',
    }
    return map[method || ''] || method || 'Không xác định'
  }
}
