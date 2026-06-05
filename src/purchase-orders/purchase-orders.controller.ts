import { Controller, Get, Patch, Body, Param, Request, Post } from '@nestjs/common'
import { PurchaseOrdersService } from './purchase-orders.service'
import { CreatePurchaseOrderDto, UpdatePOStatusDto } from './dto/purchase-order.dto'
import { Roles } from 'src/auth/decorators'

// Global JwtAuthGuard + RolesGuard already applied via APP_GUARD in app.module
@Controller('purchase-orders')
@Roles('admin', 'employee')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  // GET /purchase-orders/suppliers — Phải đứng TRƯỚC :id route
  @Get('suppliers')
  getSuppliers() {
    return this.purchaseOrdersService.getSuppliers()
  }

  // GET /purchase-orders
  @Get()
  getAll(@Request() req: any) {
    return this.purchaseOrdersService.getAll(req.user)
  }

  // GET /purchase-orders/:id
  @Get(':id')
  getOne(@Param('id') id: string, @Request() req: any) {
    return this.purchaseOrdersService.getOne(id, req.user)
  }

  // POST /purchase-orders
  @Post()
  create(@Body() dto: CreatePurchaseOrderDto, @Request() req: any) {
    return this.purchaseOrdersService.create(dto, req.user)
  }

  // PATCH /purchase-orders/:id/status
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePOStatusDto,
    @Request() req: any,
  ) {
    return this.purchaseOrdersService.updateStatus(id, dto, req.user)
  }
}
