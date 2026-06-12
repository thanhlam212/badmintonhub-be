import { Controller, Post, Get, Body, Query, Param, Req, HttpCode, Headers } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { PaymentService } from './payment.service'
import { CreatePaymentDto } from './dto/payment.dto'
import { Public, CurrentUser } from '../auth/decorators/index'

@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 10 req / 60s — chống spam tạo thanh toán
  @Post('create')
  create(@Body() dto: CreatePaymentDto, @Req() req: any) {
    const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1'
    const ipAddr = String(ip).split(',')[0].trim()
    return this.paymentService.createPayment(dto, ipAddr)
  }

  // GET /api/payment/vnpay/return — VNPay redirect sau khi thanh toán
  @Public()
  @Get('vnpay/return')
  vnpayReturn(@Query() query: Record<string, string>) {
    return this.paymentService.handleVnpayReturn(query)
  }

  // GET /api/payment/vnpay/ipn — VNPay IPN (server-to-server)
  @Public()
  @Get('vnpay/ipn')
  @HttpCode(200)
  vnpayIpn(@Query() query: Record<string, string>) {
    return this.paymentService.handleVnpayIpn(query)
  }

  // POST /api/payment/momo/ipn — MoMo IPN (server-to-server)
  @Public()
  @Post('momo/ipn')
  @HttpCode(200)
  momoIpn(@Body() body: Record<string, any>) {
    return this.paymentService.handleMomoIpn(body)
  }

  // GET /api/payment/:id — Lấy trạng thái thanh toán (có kiểm tra ownership)
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 30 } })  // 30 req / 60s — webhook cần rộng hơn vì SePay gọi liên tục
  @Post('sepay/ipn')
  @HttpCode(200)
  sepayIpn(@Body() body: Record<string, any>, @Headers() headers: Record<string, any>) {
    return this.paymentService.handleSepayIpn(body, headers)
  }

  @Get(':id')
  getStatus(@Param('id') id: string, @CurrentUser() user: any) {
    return this.paymentService.getPaymentStatus(id, user)
  }
}
