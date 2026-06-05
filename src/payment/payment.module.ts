import { Module } from '@nestjs/common'
import { PaymentController } from './payment.controller'
import { PaymentService } from './payment.service'
import { VnpayProvider } from './vnpay.provider'
import { MomoProvider } from './momo.provider'
import { SepayProvider } from './sepay.provider'

@Module({
  controllers: [PaymentController],
  providers:   [PaymentService, VnpayProvider, MomoProvider, SepayProvider],
  exports:     [PaymentService],
})
export class PaymentModule {}
