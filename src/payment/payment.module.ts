import { Module } from '@nestjs/common'
import { PaymentController } from './payment.controller'
import { PaymentService } from './payment.service'
import { VnpayProvider } from './vnpay.provider'
import { MomoProvider } from './momo.provider'
import { EmailModule } from '../email/email.module'

@Module({
  imports:     [EmailModule],
  controllers: [PaymentController],
  providers:   [PaymentService, VnpayProvider, MomoProvider],
  exports:     [PaymentService],
})
export class PaymentModule {}
