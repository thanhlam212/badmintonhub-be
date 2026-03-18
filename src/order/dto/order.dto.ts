// ═══════════════════════════════════════════════════════════════
// src/orders/dto/order.dto.ts
// ═══════════════════════════════════════════════════════════════
import { IsString, IsOptional, IsArray, IsNumber, ValidateNested, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class OrderItemDto {
  @IsNumber()
  product_id: number

  @IsNumber()
  @Min(1)
  quantity: number

  @IsNumber()
  price: number
}

export class CreateOrderDto {
  @IsString()
  customer_name: string

  @IsString()
  customer_phone: string

  @IsOptional()
  @IsString()
  customer_email?: string

  @IsString()
  shipping_address: string

  @IsOptional()
  @IsString()
  payment_method?: string

  @IsOptional()
  @IsString()
  note?: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[]
}