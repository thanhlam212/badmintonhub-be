import { Controller, Get, Post, Patch, Body, Param, Query, Request } from '@nestjs/common'
import { CreateOrderDto } from './dto/order.dto'
import { Public, Roles, CurrentUser } from '../auth/decorators/index'
import { OrderService } from './order.service'
import { JwtService } from '@nestjs/jwt'

@Controller('orders')
export class OrderController {
  constructor(
    private readonly ordersService: OrderService,
    private readonly jwtService: JwtService,
  ) {}

  // POST /api/orders — Tạo đơn hàng (public)
  @Public()
  @Post()
  create(@Body() dto: CreateOrderDto, @Request() req: any) {
    let userId: string | null = null
    const authHeader = req.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7)
      try {
        const payload = this.jwtService.verify(token)
        if (payload && payload.sub) {
          userId = payload.sub
        }
      } catch (err) {
        // Hàng đợi thanh toán/đơn hàng không lỗi nếu token hết hạn/sai
      }
    }
    return this.ordersService.create(dto, userId)
  }

  // GET /api/orders — Tất cả đơn hàng (admin)
  @Roles('admin', 'employee')
  @Get()
  findAll(@Query('status') status?: string) {
    return this.ordersService.findAll({ status })
  }

  // GET /api/orders/my — Đơn hàng của tôi
  @Get('my')
  findMyOrders(@CurrentUser() user: any) {
    return this.ordersService.findMyOrders(user.id)
  }

  // GET /api/orders/:id — Chi tiết đơn hàng
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.ordersService.findOneForUser(id, user)
  }

  // PATCH /api/orders/:id/status — Cập nhật trạng thái (admin)
  @Roles('admin', 'employee')
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string, @Request() req: any) {
    return this.ordersService.updateStatus(id, status, req.user)
  }

  // GET /api/orders/:id/invoice — Lấy hóa đơn của đơn hàng
  @Get(':id/invoice')
  getInvoice(@Param('id') id: string, @CurrentUser() user: any) {
    return this.ordersService.getInvoice(id, user)
  }
}


