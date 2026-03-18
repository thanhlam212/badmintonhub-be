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
  }) {
    if (!booking.customerEmail) return

    const dateStr = new Date(booking.bookingDate).toLocaleDateString('vi-VN', {
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
    })

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #16a34a; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">🏸 BadmintonHub</h1>
        </div>
        <div style="background: #f9fafb; padding: 32px; border-radius: 0 0 8px 8px;">
          <h2 style="color: #16a34a; margin-top: 0;">✅ Đặt sân đã được xác nhận!</h2>
          <p>Xin chào <strong>${booking.customerName}</strong>,</p>
          <p>Lịch đặt sân của bạn đã được xác nhận. Chi tiết như sau:</p>

          <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; width: 40%;">Mã đặt sân</td>
                <td style="padding: 8px 0; font-weight: bold; font-family: monospace; color: #16a34a;">${booking.id}</td>
              </tr>
              <tr style="border-top: 1px solid #f3f4f6;">
                <td style="padding: 8px 0; color: #6b7280;">Sân</td>
                <td style="padding: 8px 0; font-weight: bold;">${booking.courtName}</td>
              </tr>
              <tr style="border-top: 1px solid #f3f4f6;">
                <td style="padding: 8px 0; color: #6b7280;">Chi nhánh</td>
                <td style="padding: 8px 0;">${booking.branchName}</td>
              </tr>
              <tr style="border-top: 1px solid #f3f4f6;">
                <td style="padding: 8px 0; color: #6b7280;">Ngày chơi</td>
                <td style="padding: 8px 0; font-weight: bold;">${dateStr}</td>
              </tr>
              <tr style="border-top: 1px solid #f3f4f6;">
                <td style="padding: 8px 0; color: #6b7280;">Giờ chơi</td>
                <td style="padding: 8px 0; font-weight: bold; color: #16a34a;">${booking.timeStart} – ${booking.timeEnd}</td>
              </tr>
              <tr style="border-top: 1px solid #f3f4f6;">
                <td style="padding: 8px 0; color: #6b7280;">Tổng tiền</td>
                <td style="padding: 8px 0; font-weight: bold; font-size: 18px; color: #16a34a;">
                  ${new Intl.NumberFormat('vi-VN').format(booking.amount)}đ
                </td>
              </tr>
            </table>
          </div>
            <!-- QR Code -->
          <div style="text-align: center; margin: 24px 0;">
            <p style="font-weight: bold; color: #374151; margin-bottom: 12px;">
              📱 Mã QR Check-in
            </p>
            <img
              src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${this.frontendUrl}/my-bookings?tab=upcoming"
              alt="QR Check-in"
              width="160"
              height="160"
              style="border: 4px solid #e5e7eb; border-radius: 8px; padding: 8px; background: white;"
            />
            <p style="color: #6b7280; font-size: 12px; margin-top: 8px;">
              Xuất trình mã này khi đến sân để check-in
            </p>
          </div>
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0; color: #166534; font-size: 14px;">
              📌 <strong>Lưu ý:</strong> Vui lòng đến đúng giờ và xuất trình mã đặt sân khi check-in tại quầy.
            </p>
          </div>

          <p style="color: #6b7280; font-size: 14px; margin-top: 32px;">
            Nếu cần hỗ trợ, vui lòng liên hệ hotline hoặc reply email này.<br/>
            Chúc bạn có buổi chơi cầu lông vui vẻ! 🏸
          </p>

          <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 24px; text-align: center; color: #9ca3af; font-size: 12px;">
            © 2025 BadmintonHub. All rights reserved.
          </div>
        </div>
      </div>
    `

    try {
      await this.transporter.sendMail({
        from: `"BadmintonHub" <${process.env.MAIL_USER}>`,
        to: booking.customerEmail,
        subject: `✅ Xác nhận đặt sân ${booking.courtName} - ${dateStr}`,
        html,
      })
      this.logger.log(`Email sent to ${booking.customerEmail} for booking ${booking.id}`)
    } catch (err) {
      // Không throw lỗi — email thất bại không ảnh hưởng nghiệp vụ
      this.logger.error(`Failed to send email for booking ${booking.id}:`, err)
    }
  }
}