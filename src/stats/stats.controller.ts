// src/stats/stats.controller.ts
import { Controller, Get, Query } from '@nestjs/common'
import { StatsService } from './stats.service'
import { Roles } from '../auth/decorators/index'

@Roles('admin', 'employee')
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  // GET /api/stats/dashboard?range=7d|30d|month|today
  @Get('dashboard')
  getDashboard(@Query('range') range: string = '30d') {
    return this.statsService.getDashboard(range)
  }
}