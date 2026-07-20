// src/stats/stats.controller.ts
import { Controller, Get, Query } from '@nestjs/common'
import { StatsService } from './stats.service'
import { CurrentUser, Roles } from '../auth/decorators/index'

@Roles('admin', 'employee')
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  // GET /api/stats/dashboard?range=7d|30d|month|today
  @Get('dashboard')
  getDashboard(@Query('range') range: string = '30d') {
    return this.statsService.getDashboard(range)
  }

  // GET /api/stats/employee-report?range=today|week|month|30d|date|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
  @Get('employee-report')
  getEmployeeReport(
    @CurrentUser() user: any,
    @Query('range') range: string = 'today',
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.statsService.getEmployeeReport(user, range, branchId, from, to)
  }
}
