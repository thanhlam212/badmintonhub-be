import { Controller, Get, Post, Patch, Body, Param, Request, UseGuards } from '@nestjs/common'
import { TransfersService } from './transfers.service'
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators';

@Controller('transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'employee')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get()
  getAll(@Request() req: any) {
    return this.transfersService.getAll(req.user)
  }

  @Post()
  create(
    @Body() dto: { from_warehouse_id: number; to_warehouse_id: number; note?: string; items: { sku: string; quantity: number }[] },
    @Request() req: any,
  ) {
    return this.transfersService.create(dto, req.user)
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @Request() req: any,
  ) {
    return this.transfersService.updateStatus(id, body.status, req.user)
  }
}