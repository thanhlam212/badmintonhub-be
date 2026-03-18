import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { EmailModule } from '../email/email.module'

@Module({
  imports: [EmailModule], 
  providers: [BookingsService],
  controllers: [BookingsController],
  exports: [BookingsService], // Export để dùng trong EmployeesService (khi nhân viên đặt sân cho khách)
})
export class BookingsModule {}
