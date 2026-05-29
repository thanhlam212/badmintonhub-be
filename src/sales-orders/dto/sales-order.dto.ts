import {
  IsString, IsOptional, IsInt, IsNumber, IsArray,
  IsEnum, Min, ValidateNested, IsNotEmpty,
} from 'class-validator'
import { Type } from 'class-transformer'

export class SalesOrderItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  product_id?: number | null

  @IsString()
  @IsNotEmpty()
  product_name: string

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty: number
}

export class CreateSalesOrderDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  branch_id?: number

  @IsString()
  @IsOptional()
  customer_name?: string

  @IsString()
  @IsOptional()
  customer_phone?: string

  // Extra FE fields — accepted but stored in note or ignored
  @IsString()
  @IsOptional()
  order_type?: string

  @IsString()
  @IsOptional()
  fulfillment_mode?: string

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  fulfill_warehouse_id?: number

  @Type(() => Number)
  @IsInt()
  @IsOptional()
  transfer_source_warehouse_id?: number

  @IsString()
  @IsOptional()
  expected_pickup_date?: string

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  total?: number

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  discount?: number

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  final_total?: number

  @IsString()
  @IsOptional()
  payment_status?: string

  @IsString()
  @IsOptional()
  payment_method?: string

  @IsString()
  @IsOptional()
  note?: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderItemDto)
  items: SalesOrderItemDto[]
}

export class UpdateSalesOrderStatusDto {
  @IsString()
  @IsOptional()
  payment_method?: string

  @IsString()
  @IsOptional()
  note?: string

  @IsString()
  @IsOptional()
  reject_reason?: string
}

export class CreateWalkInAccountDto {
  @IsString()
  @IsNotEmpty()
  full_name: string

  @IsString()
  @IsNotEmpty()
  phone: string

  @IsOptional()
  create_account?: boolean
}
