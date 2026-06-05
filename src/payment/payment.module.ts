import { Module } from '@nestjs/common'
import { PaymentController } from './payment.controller'
import { PaymentService } from './payment.service'
import { VnpayProvider } from './vnpay.provider'
import { MomoProvider } from './momo.provider'
<<<<<<< HEAD
import { EmailModule } from '../email/email.module'
=======
import { SepayProvider } from './sepay.provider'
>>>>>>> a207e7f05af68b61a5b4e549e4878089e1c55522

@Module({
  imports:     [EmailModule],
  controllers: [PaymentController],
  providers:   [PaymentService, VnpayProvider, MomoProvider, SepayProvider],
  exports:     [PaymentService],
})
export class PaymentModule {}
