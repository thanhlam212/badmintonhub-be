import { Controller, Get, Patch, Body, Param, Request, UseGuards, Post } from '@nestjs/common'
import { PurchaseOrdersService } from './purchase-orders.service'
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard'
import { RolesGuard } from 'src/auth/guards/roles.guard'
import { Roles } from 'src/auth/decorators'

@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'employee')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Post()
  create(@Body() dto: any, @Request() req: any) {
  return this.purchaseOrdersService.create(dto, req.user)
}

  @Get()
  getAll(@Request() req: any) {
    return this.purchaseOrdersService.getAll(req.user)
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.purchaseOrdersService.updateStatus(id, body.status)
  }

  
}