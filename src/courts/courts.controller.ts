import {
  Controller, Get, Post, Put, Patch,
  Body, Param, Query, ParseIntPipe,
} from '@nestjs/common';
import { CourtsService } from './courts.service';
import { CreateCourtDto, UpdateCourtDto, CreateReviewDto } from './dto/court.dto';
import { Public, Roles, CurrentUser } from '../auth/decorators/index';

@Controller('courts')
export class CourtsController {
  constructor(private readonly courtsService: CourtsService) {}

  // GET /api/courts?branchId=1&type=premium&indoor=true  (Public)
  @Public()
  @Get()
  findAll(
    @Query('branchId') branchId?: string,
    @Query('type') type?: string,
    @Query('indoor') indoor?: string,
  ) {
    return this.courtsService.findAll({
      branchId: branchId ? +branchId : undefined,
      type,
      indoor: indoor !== undefined ? indoor === 'true' : undefined,
    });
  }

  // GET /api/courts/:id  (Public)
  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.courtsService.findOne(id);
  }

  // GET /api/courts/:id/slots?date=2025-03-10  (Public)
  @Public()
  @Get(':id/slots')
  getSlots(
    @Param('id', ParseIntPipe) id: number,
    @Query('date') date: string,
  ) {
    return this.courtsService.getSlots(id, date);
  }

  // GET /api/courts/:id/reviews  (Public)
  @Public()
  @Get(':id/reviews')
  getReviews(@Param('id', ParseIntPipe) id: number) {
    return this.courtsService.getReviews(id);
  }

  // POST /api/courts/:id/reviews  (User cần login)
  @Post(':id/reviews')
  createReview(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Body() dto: CreateReviewDto,
  ) {
    return this.courtsService.createReview(id, user.id, dto);
  }

  // POST /api/courts  (Admin only)
  @Roles('admin')
  @Post()
  create(@Body() dto: CreateCourtDto) {
    return this.courtsService.create(dto);
  }

  // PUT /api/courts/:id  (Admin only)
  @Roles('admin')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCourtDto) {
    return this.courtsService.update(id, dto);
  }

  // PATCH /api/courts/:id/toggle  (Admin only)
  @Roles('admin')
  @Patch(':id/toggle')
  toggle(@Param('id', ParseIntPipe) id: number) {
    return this.courtsService.toggle(id);
  }
}