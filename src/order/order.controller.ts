// ═══════════════════════════════════════════════════════════════
// src/orders/orders.controller.ts
// ═══════════════════════════════════════════════════════════════
import { Controller, Get, Post, Patch, Body, Param, Query, Request } from '@nestjs/common'
import { CreateOrderDto } from './dto/order.dto'
import { Public, Roles, CurrentUser } from '../auth/decorators/index'
import { OrderService } from './order.service'

@Controller('orders')
export class OrderController {
  constructor(private readonly ordersService: OrderService) {}

  // POST /api/orders — Tạo đơn hàng (public)
  @Public()
  @Post()
  create(@Body() dto: CreateOrderDto, @Request() req: any) {
    const userId = req.user?.id || null
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
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id)
  }

  // PATCH /api/orders/:id/status — Cập nhật trạng thái (admin)
  @Roles('admin', 'employee')
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.ordersService.updateStatus(id, status)
  }
}


