import { Controller, Get, Post, Body, Param, Query, ParseIntPipe, Request } from '@nestjs/common'
import { InventoryService } from './inventory.service'
import { ImportStockDto, ExportStockDto } from './dto/inventory.dto'
import { Roles } from 'src/auth/decorators'

// Global JwtAuthGuard + RolesGuard already applied via APP_GUARD in app.module
@Controller('inventory')
@Roles('admin', 'employee')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // GET /inventory/warehouses  — danh sách kho (auth-context gọi khi login)
  // Phải đứng TRƯỚC :id route để không bị match nhầm
  @Get('warehouses')
  getWarehouses() {
    return this.inventoryService.getWarehouses()
  }

  // GET /inventory/low-stock
  @Get('low-stock')
  getLowStock(@Request() req: any) {
    return this.inventoryService.getLowStock(req.user)
  }

  // GET /inventory/transactions
  @Get('transactions')
  getTransactions(@Request() req: any) {
    return this.inventoryService.getTransactions(req.user)
  }

  // GET /inventory/warehouse/:id  — inventory của 1 kho cụ thể
  @Get('warehouse/:id')
  getByWarehouse(@Param('id', ParseIntPipe) id: number) {
    return this.inventoryService.getByWarehouse(id)
  }

  // GET /inventory  — all inventory (theo role), hỗ trợ filter query params
  @Get()
  getAll(
    @Request() req: any,
    @Query('warehouseId') warehouseId?: string,
    @Query('category')   category?: string,
    @Query('search')     search?: string,
    @Query('lowStock')   lowStock?: string,
  ) {
    return this.inventoryService.getAll(req.user, {
      warehouseId: warehouseId ? +warehouseId : undefined,
      category,
      search,
      lowStock: lowStock === 'true',
    })
  }

  // POST /inventory/import
  @Post('import')
  importStock(@Body() dto: ImportStockDto, @Request() req: any) {
    return this.inventoryService.importStock(dto, req.user)
  }

  // POST /inventory/export
  @Post('export')
  exportStock(@Body() dto: ExportStockDto, @Request() req: any) {
    return this.inventoryService.exportStock(dto, req.user)
  }
}
