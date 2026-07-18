import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BookingsService } from './bookings.service';
import {
  CancelBookingDto,
  CreateBookingDto,
  CreateRecurringDto,
  UpdateServicesDto,
  FixedScheduleAdjustDto,
  FixedScheduleConfirmDto,
  FixedSchedulePreviewDto,
  UpdateBookingStatusDto,
  UpdateFixedScheduleAdjustmentLimitDto,
  CheckSlotDto,
} from './dto/booking.dto';
import { Public, Roles, CurrentUser } from '../auth/decorators/index';
import { fallbackDocumentCode } from './booking.helpers';

// ─── Booking mapper ─────────────────────────────────────────────
// FE's transformBooking() reads snake_case — mapper flattens Prisma camelCase → snake_case
function mapBooking(b: any) {
  if (!b) return b;
  
  let invoiceCodeVal = b.bookingCode || b.code || b.invoiceCode || '';
  if (!invoiceCodeVal && Array.isArray(b.invoices) && b.invoices.length > 0) {
    invoiceCodeVal = b.invoices[0]?.code || '';
  }
  if (!invoiceCodeVal && b.invoice?.code) {
    invoiceCodeVal = b.invoice.code;
  }
  if (!invoiceCodeVal && b.id) {
    const prefix = (b.fixedScheduleId || b.fixedOccurrenceId) ? 'FS' : 'MB';
    invoiceCodeVal = fallbackDocumentCode(prefix, b);
  }

  return {
    id:                 b.id,
    booking_code:       invoiceCodeVal,
    court_id:           b.courtId,
    court_name:         b.court?.name || b.courtName || '',
    branch_name:        b.branch?.name || b.branchName || b.court?.branch?.name || '',
    user_id:            b.userId ?? null,
    booked_by_role:     b.user?.role ?? null,
    booked_by_name:     b.user?.fullName ?? null,
    booked_by_username: b.user?.username ?? null,
    customer_name:      b.customerName || '',
    customer_phone:     b.customerPhone || '',
    booking_date:
      b.bookingDate instanceof Date
        ? b.bookingDate.toISOString().split('T')[0]
        : b.bookingDate,
    time_start:         b.timeStart,
    time_end:           b.timeEnd,
    slots:              b.people ?? b.slots ?? 1,
    amount:             parseFloat(String(b.amount ?? 0)),
    status:             b.status,
    payment_method:     b.paymentMethod ?? null,
    note:               b.note ?? null,
    customer_email:     b.customerEmail ?? b.user?.email ?? null,
    cancellation_reason: b.cancellationReason ?? null,
    cancelled_at:       b.cancelledAt ?? null,
    cancelled_by_name:  b.cancelledByName ?? null,
    cancelled_by_role:  b.cancelledByRole ?? null,
    service_lines:      b.serviceLines ?? null,
    service_paid_hash:  b.servicePaidHash ?? null,
    service_paid_at:    b.servicePaidAt ?? null,
    invoice_id:         b.invoiceId ?? (Array.isArray(b.invoices) ? b.invoices[0]?.id : null) ?? b.invoice?.id ?? null,
    invoice_status:     b.invoiceStatus ?? (Array.isArray(b.invoices) ? (b.invoices[0]?.status ?? null) : null),
    fixed_schedule_id:  b.fixedScheduleId ?? null,
    fixed_occurrence_id: b.fixedOccurrenceId ?? null,
    created_at:         b.createdAt,
  }
}

// Extract booking from service result (service returns { success, booking } or raw object)
function extractBooking(result: any): any {
  if (result && typeof result === 'object' && 'booking' in result) return result.booking
  return result
}

// ─── Controller ─────────────────────────────────────────────────

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  // ─────────────────────────────────────────────────────
  // POST /api/bookings/release-expired
  // FE gọi khi đồng hồ đếm ngược về 0 để hủy chỗ hết hạn
  // Public vì FE không có auth khi timer hết hạn
  // ─────────────────────────────────────────────────────
  @Public()
  @Post('release-expired')
  async releaseExpired() {
    await this.bookingsService.releaseAllExpiredBookings()
    return { success: true, message: 'Đã giải phóng các chỗ hết hạn' }
  }

  // ─────────────────────────────────────────────────────
  // POST /api/bookings — Đặt sân thường
  // ─────────────────────────────────────────────────────
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 10 req / 60s — chống spam tạo booking
  @Post()
  async create(@Body() dto: CreateBookingDto, @CurrentUser() user: any) {
    const booking = await this.bookingsService.create(dto, user)
    return { success: true, data: mapBooking(booking) }
  }

  // ─────────────────────────────────────────────────────
  // POST /api/bookings/fixed/preview
  // POST /api/bookings/fixed/confirm
  // ─────────────────────────────────────────────────────
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })  // 5 req / 60s — chống spam đăng ký lịch cố định
  @Post('fixed/preview')
  previewFixed(@Body() dto: FixedSchedulePreviewDto) {
    return this.bookingsService.previewFixedSchedule(dto)
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })  // 5 req / 60s
  @Post('fixed/confirm')
  confirmFixed(
    @Body() dto: FixedScheduleConfirmDto,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.confirmFixedSchedule(dto, user.id)
  }

  // ─────────────────────────────────────────────────────
  // POST /api/bookings/fixed/check-slot
  // ─────────────────────────────────────────────────────
  @Public()
  @Post('fixed/check-slot')
  checkSlot(@Body() dto: CheckSlotDto) {
    return this.bookingsService.checkSlotAvailability(dto)
  }

  // ─────────────────────────────────────────────────────
  // POST /api/bookings/hold — Giữ chỗ (pending)
  // Cùng luồng create nhưng FE dùng endpoint riêng
  // ─────────────────────────────────────────────────────
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })  // 10 req / 60s — chống spam lock slot
  @Post('hold')
  async createHold(@Body() dto: CreateBookingDto, @CurrentUser() user: any) {
    const booking = await this.bookingsService.create(dto, user);
    return { success: true, data: mapBooking(booking) };
  }

  // ─────────────────────────────────────────────────────
  // POST /api/bookings/recurring — Tạo booking lặp lại theo tuần
  // ─────────────────────────────────────────────────────
  @Post('recurring')
  @Roles('admin', 'employee')
  async createRecurring(@Body() dto: CreateRecurringDto, @CurrentUser() user: any) {
    const result = await this.bookingsService.createRecurring(dto, user);
    return {
      success: true,
      data: result.data?.map(mapBooking),
      errors: result.errors,
      message: `Tạo thành công ${result.created}/${dto.weeks} booking`,
    };
  }

  // ─────────────────────────────────────────────────────
  // POST /api/bookings/checkin — Employee scans / confirms checkin
  // FE gửi: { bookingId?, bookingCode? }
  // ─────────────────────────────────────────────────────
  @Post('checkin')
  @Roles('admin', 'employee')
  async checkin(
    @Body() body: { bookingId?: string; bookingCode?: string },
    @CurrentUser() user: any,
  ) {
    const id = body.bookingId || body.bookingCode
    const result = await this.bookingsService.checkin(id!, user)
    // Return booking with camelCase keys matching the FE CheckinResult interface
    return {
      message: result.message || 'Check-in thành công',
      booking: result.booking,
    }
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/fixed/my — Danh sách gói của user
  // (Must come BEFORE :id to avoid route conflict)
  // ─────────────────────────────────────────────────────
  @Get('fixed/my')
  getMyFixedSchedules(@CurrentUser() user: any) {
    return this.bookingsService.findMyFixedSchedules(user.id)
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/today
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Get('today')
  async getToday(@Query('branchId') branchId?: string) {
    const bookings = await this.bookingsService.getTodayBookings(
      branchId ? +branchId : undefined,
    )
    return { success: true, data: bookings.map(mapBooking) }
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/my — Lịch sử booking của user hiện tại
  // ─────────────────────────────────────────────────────
  @Get('my')
  async getMyBookings(@CurrentUser() user: any) {
    const bookings = await this.bookingsService.findByUser(user.id)
    return { success: true, data: bookings.map(mapBooking) }
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/user/:userId (Admin)
  // ─────────────────────────────────────────────────────
  @Roles('admin')
  @Get('user/:userId')
  async findByUser(@Param('userId') userId: string) {
    const bookings = await this.bookingsService.findByUser(userId)
    return { success: true, data: bookings.map(mapBooking) }
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings — Danh sách (Admin/Employee)
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Get()
  async findAll(
    @Query('branchId') branchId?: string,
    @Query('courtId')  courtId?: string,
    @Query('date')     date?: string,
    @Query('status')   status?: string,
    @Query('phone')    phone?: string,
  ) {
    const bookings = await this.bookingsService.findAll({
      branchId: branchId ? +branchId : undefined,
      courtId:  courtId  ? +courtId  : undefined,
      date,
      status,
      phone,
    })
    return { success: true, data: bookings.map(mapBooking) }
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/fixed/:scheduleId — Chi tiết gói cố định
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Get('fixed/all')
  getAllFixedSchedules(@Query('branchId') branchId?: string) {
    return this.bookingsService.findAllFixedSchedules(
      branchId ? Number(branchId) : undefined,
    )
  }

  @Get('fixed/:scheduleId')
  getFixedScheduleDetail(
    @Param('scheduleId') scheduleId: string,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.findFixedScheduleDetail(scheduleId, user)
  }

  // ─────────────────────────────────────────────────────
  // GET /api/bookings/:id — Chi tiết booking thường
  // ─────────────────────────────────────────────────────
  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    const booking = await this.bookingsService.findOneForUser(id, user)
    return { success: true, data: mapBooking(booking) }
  }

  // ─────────────────────────────────────────────────────
  // PATCH /api/bookings/:id/confirm
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Patch(':id/confirm')
  async confirm(@Param('id') id: string) {
    const result = await this.bookingsService.confirm(id)
    return { success: true, data: mapBooking(extractBooking(result)) }
  }

  // ─────────────────────────────────────────────────────
  // PATCH /api/bookings/:id/cancel
  // ─────────────────────────────────────────────────────
  @Patch(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
    @CurrentUser() user: any,
  ) {
    const result = await this.bookingsService.cancelForUser(id, user, dto)
    return { success: true, data: mapBooking(extractBooking(result)) }
  }

  // ─────────────────────────────────────────────────────
  // PATCH /api/bookings/:id/confirm-payment — Xác nhận thanh toán
  // pending / deposited → confirmed
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Patch(':id/confirm-payment')
  async confirmPayment(@Param('id') id: string) {
    const result = await this.bookingsService.confirm(id);
    return { success: true, data: mapBooking(extractBooking(result)), message: 'Xác nhận thanh toán thành công' };
  }

  // ─────────────────────────────────────────────────────
  // PATCH /api/bookings/:id/services — Cập nhật dịch vụ
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Patch(':id/services')
  async updateServices(
    @Param('id') id: string,
    @Body() dto: UpdateServicesDto,
  ) {
    const booking = await this.bookingsService.updateServices(id, dto);
    return {
      success: true,
      data: mapBooking(booking),
      message: 'Cập nhật dịch vụ thành công',
    };
  }

  // ─────────────────────────────────────────────────────
  // PATCH /api/bookings/:id/status
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateBookingStatusDto,
    @CurrentUser() user: any,
  ) {
    const result = await this.bookingsService.updateStatus(id, dto, user)
    return { success: true, data: mapBooking(extractBooking(result)) }
  }

  // ─────────────────────────────────────────────────────
  // PATCH /bookings/fixed/:scheduleId/occurrences/:occurrenceId/adjust
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Patch('fixed/:scheduleId/confirm-payment')
  async confirmFixedSchedulePayment(
    @Param('scheduleId') scheduleId: string,
    @Body() body: { paymentMethod?: string },
  ) {
    const result = await this.bookingsService.confirmFixedSchedulePayment(
      scheduleId,
      body?.paymentMethod,
    )
    return { success: true, data: result, message: result.message }
  }

  @Patch('fixed/:scheduleId/occurrences/:occurrenceId/adjust')
  adjustFixed(
    @Param('scheduleId') scheduleId: string,
    @Param('occurrenceId') occurrenceId: string,
    @Body() dto: FixedScheduleAdjustDto,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.adjustFixedOccurrence(scheduleId, occurrenceId, dto, user)
  }

  @Patch('fixed/:scheduleId/occurrences/:occurrenceId/adjust-request')
  requestFixedAdjust(
    @Param('scheduleId') scheduleId: string,
    @Param('occurrenceId') occurrenceId: string,
    @Body() dto: FixedScheduleAdjustDto,
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.requestFixedOccurrenceAdjustment(scheduleId, occurrenceId, dto, user)
  }

  @Roles('admin', 'employee')
  @Patch('fixed/adjustments/:adjustmentId/review')
  reviewFixedAdjust(
    @Param('adjustmentId') adjustmentId: string,
    @Body() body: { approve: boolean; reason?: string },
    @CurrentUser() user: any,
  ) {
    return this.bookingsService.reviewFixedAdjustmentRequest(adjustmentId, body, user)
  }

  @Roles('admin', 'employee')
  @Patch('fixed/:scheduleId/adjustment-limit')
  async updateFixedScheduleAdjustmentLimit(
    @Param('scheduleId') scheduleId: string,
    @Body() dto: UpdateFixedScheduleAdjustmentLimitDto,
    @CurrentUser() user: any,
  ) {
    const result = await this.bookingsService.updateFixedScheduleAdjustmentLimit(scheduleId, dto, user)
    return { success: true, data: result, message: 'Đã cập nhật số lượt đổi lịch cố định' }
  }

  @Roles('admin', 'employee')
  @Delete('fixed/:scheduleId')
  async deleteFixedScheduleTrash(@Param('scheduleId') scheduleId: string) {
    const result = await this.bookingsService.deleteFixedScheduleTrash(scheduleId)
    return { success: true, data: result, message: result.message }
  }

  @Roles('admin', 'employee')
  @Patch('fixed/:scheduleId/delete-trash')
  async deleteFixedScheduleTrashAction(@Param('scheduleId') scheduleId: string) {
    const result = await this.bookingsService.deleteFixedScheduleTrash(scheduleId)
    return { success: true, data: result, message: result.message }
  }

  // ─────────────────────────────────────────────────────
  // DELETE /api/bookings/:id — Xóa booking (admin/employee)
  // ─────────────────────────────────────────────────────
  @Roles('admin', 'employee')
  @Delete(':id')
  async deleteBooking(@Param('id') id: string) {
    const result = await this.bookingsService.deleteBooking(id)
    return { success: true, message: result.message }
  }
}
