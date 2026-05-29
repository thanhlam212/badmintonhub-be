import { Controller, Get, Post, Patch, Body, Param, Request } from '@nestjs/common'
import { TransfersService } from './transfers.service'
import { CreateTransferDto, UpdateTransferStatusDto } from './dto/transfer.dto'
import { Roles } from 'src/auth/decorators'

// Global JwtAuthGuard + RolesGuard already applied via APP_GUARD in app.module
@Controller('transfers')
@Roles('admin', 'employee')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get()
  getAll(@Request() req: any) {
    return this.transfersService.getAll(req.user)
  }

  @Get(':id')
  getOne(@Param('id') id: string, @Request() req: any) {
    return this.transfersService.getOne(id, req.user)
  }

  @Post()
  create(@Body() dto: CreateTransferDto, @Request() req: any) {
    return this.transfersService.create(dto, req.user)
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTransferStatusDto,
    @Request() req: any,
  ) {
    return this.transfersService.updateStatus(id, dto, req.user)
  }
}
