import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { EmailModule } from '../email/email.module'
import { FixedScheduleService } from './fixed-schedule.service';

@Module({
  imports: [EmailModule], 
  providers: [BookingsService, FixedScheduleService],
  controllers: [BookingsController],
  exports: [BookingsService, FixedScheduleService], 
})
export class BookingsModule {}
