import {
  Controller, Get, Post, Patch,
  Body, Param, Query,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import {
  CreateBookingDto,
  FixedScheduleAdjustDto,
  FixedScheduleConfirmDto,
  FixedSchedulePreviewDto,
  UpdateBookingStatusDto,
  CheckSlotDto,
} from './dto/booking.dto';
import { Public, Roles, CurrentUser } from '../auth/decorators/index';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  // ─────────────────────────────────────────────────────
  // POST /api/bookings — Đặt sân thường
  // ─────────────────────────────────────────────────────
  @Public()
  @Post()
  create(@Body() dto: CreateBookingDto) {
    return this.bookingsService.create(dto);
  }

  // ─────────────────────────────────────────────────────
  // POST /api/bookings/fixed/preview
  // POST /api/bookings/fixed/confirm
  // ─────────────────────────────────────────────────────
  @Public()
  @Post('fixed/preview')
  previewFixed(@Body() dto: FixedSchedulePreviewDto) {
    return this.bookingsService.previewFixedSchedule(dto);
  }

  @Public()
  @Post('fixed/confirm')
  confirmFixed(@Body() dto: FixedScheduleConfirmDto) {
    return this.bookingsService.confirmFixedSchedule(dto);
  }

  // ─────────────────────────────────────────────────────
  // POST /api/bookings/fixed/check-slot
  // Kiểm tra 1 slot có available không (dùng trong modal đổi giờ)
  // ─────────────────────────────────────────────────────
  @Public()
  @Post('fixed/check-slot')
  checkSlot(@Body() dto: CheckSlotDto) {
    return this.bookingsService.checkSlotAvailability(dto);
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/fixed/my — Danh sách gói của user
  // ─────────────────────────────────────────────────────
  @Get('fixed/my')
  getMyFixedSchedules(@CurrentUser() user: any) {
    return this.bookingsService.findMyFixedSchedules(user.id);
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/fixed/:scheduleId — Chi tiết gói
  // ─────────────────────────────────────────────────────
  @Get('fixed/:scheduleId')
  getFixedScheduleDetail(
    @Param('scheduleId') scheduleId: string,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.findFixedScheduleDetail(scheduleId, user);
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings — Danh sách (Admin/Employee)
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Get()
  findAll(
    @Query('branchId') branchId?: string,
    @Query('courtId')  courtId?: string,
    @Query('date')     date?: string,
    @Query('status')   status?: string,
    @Query('phone')    phone?: string,
  ) {
    return this.bookingsService.findAll({
      branchId: branchId ? +branchId : undefined,
      courtId:  courtId  ? +courtId  : undefined,
      date,
      status,
      phone,
    });
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/today
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Get('today')
  getToday(@Query('branchId') branchId?: string) {
    return this.bookingsService.getTodayBookings(
      branchId ? +branchId : undefined
    );
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/my — Lịch sử booking thường
  // ─────────────────────────────────────────────────────
  @Get('my')
  getMyBookings(@CurrentUser() user: any) {
    return this.bookingsService.findByUser(user.id);
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/user/:userId (Admin)
  // ─────────────────────────────────────────────────────
  @Roles('admin')
  @Get('user/:userId')
  findByUser(@Param('userId') userId: string) {
    return this.bookingsService.findByUser(userId);
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/:id — Chi tiết booking thường
  // ─────────────────────────────────────────────────────
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.bookingsService.findOneForUser(id, user);
  }

  // ─────────────────────────────────────────────────────
  // PATCH /api/bookings/:id/confirm
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Patch(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.bookingsService.confirm(id);
  }

  // ─────────────────────────────────────────────────────
  // PATCH /api/bookings/:id/cancel
  // ─────────────────────────────────────────────────────
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.bookingsService.cancelForUser(id, user);
  }

  // ─────────────────────────────────────────────────────
  // PATCH /api/bookings/:id/status
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return this.bookingsService.updateStatus(id, dto);
  }

  // ─────────────────────────────────────────────────────
  // POST /api/bookings/checkin
  // ─────────────────────────────────────────────────────
  @Post('checkin')
  @Roles('admin', 'employee')
  checkin(@Body('bookingId') bookingId: string) {
    return this.bookingsService.checkin(bookingId);
  }

  // ─────────────────────────────────────────────────────
  // PATCH /bookings/fixed/:scheduleId/occurrences/:occurrenceId/adjust
  // ─────────────────────────────────────────────────────
  @Patch('fixed/:scheduleId/occurrences/:occurrenceId/adjust')
  adjustFixed(
    @Param('scheduleId') scheduleId: string,
    @Param('occurrenceId') occurrenceId: string,
    @Body() dto: FixedScheduleAdjustDto,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.adjustFixedOccurrence(scheduleId, occurrenceId, dto, user);
  }
}