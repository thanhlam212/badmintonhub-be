import { IsString, IsUUID, IsIn } from 'class-validator'

export class CreatePaymentDto {
  @IsUUID()
  invoiceId: string

  @IsString()
  @IsIn(['vnpay', 'momo'])
  method: 'vnpay' | 'momo'
}
