import {
  Controller, Get, Post, Patch,
  Body, Param, Query,
} from '@nestjs/common'
import { SalesOrdersService } from './sales-orders.service'
import {
  CreateSalesOrderDto, UpdateSalesOrderStatusDto, CreateWalkInAccountDto,
} from './dto/sales-order.dto'
import { Roles, CurrentUser } from '../auth/decorators/index'

@Controller('sales-orders')
@Roles('admin', 'employee')
export class SalesOrdersController {
  constructor(private readonly service: SalesOrdersService) {}

  // GET /sales-orders/customers?search=... — PHẢI đứng trước :id
  @Get('customers')
  searchCustomers(@Query('search') search: string) {
    return this.service.searchCustomers(search ?? '')
  }

  // POST /sales-orders/customers/walk-in-account — PHẢI đứng trước :id
  @Post('customers/walk-in-account')
  createWalkInAccount(@Body() dto: CreateWalkInAccountDto) {
    return this.service.createWalkInAccount(dto)
  }

  // GET /sales-orders
  @Get()
  findAll(
    @Query('status')   status?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.findAll({
      status,
      branchId: branchId ? +branchId : undefined,
    })
  }

  // GET /sales-orders/:id
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  // POST /sales-orders
  @Post()
  create(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: any) {
    return this.service.create(dto, user.id)
  }

  // PATCH /sales-orders/:id/approve
  @Patch(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() payload: UpdateSalesOrderStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.service.approve(id, payload, user.id)
  }

  // PATCH /sales-orders/:id/reject
  @Patch(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() payload: UpdateSalesOrderStatusDto,
  ) {
    return this.service.reject(id, payload)
  }

  // PATCH /sales-orders/:id/confirm-payment
  @Patch(':id/confirm-payment')
  confirmPayment(
    @Param('id') id: string,
    @Body() payload: UpdateSalesOrderStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.service.confirmPayment(id, payload, user.id)
  }

  // PATCH /sales-orders/:id/complete
  @Patch(':id/complete')
  complete(@Param('id') id: string) {
    return this.service.complete(id)
  }
}
