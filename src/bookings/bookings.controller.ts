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
} from './dto/booking.dto';
import { Public, Roles, CurrentUser } from '../auth/decorators/index';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  // ─────────────────────────────────────────────────────
  // POST /api/bookings — Đặt sân
  // Public: khách vãng lai cũng đặt được (không cần login)
  // ─────────────────────────────────────────────────────
  @Public()
  @Post()
  create(@Body() dto: CreateBookingDto) {
    return this.bookingsService.create(dto);
  }

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
  // GET /api/bookings — Danh sách (Admin/Employee)
  // ?branchId=1&date=2025-03-10&status=pending&phone=090
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
  // GET /api/bookings/today — Booking hôm nay (Dashboard)
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Get('today')
  getToday(@Query('branchId') branchId?: string) {
    return this.bookingsService.getTodayBookings(
      branchId ? +branchId : undefined
    );
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/my — Lịch sử đặt sân của user
  // ─────────────────────────────────────────────────────
  @Get('my')
  getMyBookings(@CurrentUser() user: any) {
    return this.bookingsService.findByUser(user.id);
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/user/:userId — Booking của 1 user (Admin)
  // ─────────────────────────────────────────────────────
  @Roles('admin')
  @Get('user/:userId')
  findByUser(@Param('userId') userId: string) {
    return this.bookingsService.findByUser(userId);
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/:id — Chi tiết booking
  // ─────────────────────────────────────────────────────
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.bookingsService.findOneForUser(id, user);
  }

  // ─────────────────────────────────────────────────────
  // PATCH /api/bookings/:id/confirm — Xác nhận (Admin/Employee)
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Patch(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.bookingsService.confirm(id);
  }

  // ─────────────────────────────────────────────────────
  // PATCH /api/bookings/:id/cancel — Hủy booking
  // User tự hủy hoặc Admin hủy
  // ─────────────────────────────────────────────────────
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.bookingsService.cancelForUser(id, user);
  }

  // ─────────────────────────────────────────────────────
  // PATCH /api/bookings/:id/status — Cập nhật trạng thái (Admin/Employee)
  // Body: { status: "confirmed" | "playing" | "completed" | "cancelled" }
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return this.bookingsService.updateStatus(id, dto);
  }

  // POST /bookings/checkin — Quét QR check-in
  // Body: { bookingId: string }
  @Post('checkin')
  @Roles('admin', 'employee')
  checkin(@Body('bookingId') bookingId: string) {
    return this.bookingsService.checkin(bookingId);
  }

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
