import { Controller, Get, Post, Body, Request, UseGuards } from '@nestjs/common'
import { InventoryService } from './inventory.service'
import { RolesGuard } from 'src/auth/guards/roles.guard'
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard'
import { Roles } from 'src/auth/decorators'


@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'employee')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  getAll(@Request() req: any) {
    return this.inventoryService.getAll(req.user)
  }

  @Get('low-stock')
  getLowStock(@Request() req: any) {
    return this.inventoryService.getLowStock(req.user)
  }

  @Get('transactions')
  getTransactions(@Request() req: any) {
    return this.inventoryService.getTransactions(req.user)
  }

  @Post('import')
  importStock(
    @Body() dto: { warehouse_id: number; sku: string; quantity: number; note?: string },
    @Request() req: any,
  ) {
    return this.inventoryService.importStock(dto, req.user)
  }

  @Post('export')
  exportStock(
    @Body() dto: { warehouse_id: number; sku: string; quantity: number; note?: string },
    @Request() req: any,
  ) {
    return this.inventoryService.exportStock(dto, req.user)
  }
}