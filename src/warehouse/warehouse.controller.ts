import { Controller, Get, UseGuards } from '@nestjs/common'
import { WarehouseService } from './warehouse.service'
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard'
import { RolesGuard } from 'src/auth/guards/roles.guard'
import { Roles } from 'src/auth/decorators'

@Controller('warehouse')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'employee')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get('warehouses')
  getWarehouses() {
    return this.warehouseService.getWarehouses()
  }

  @Get('suppliers')
  getSuppliers() {
    return this.warehouseService.getSuppliers()
  }
}