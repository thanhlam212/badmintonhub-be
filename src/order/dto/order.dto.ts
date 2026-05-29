import {
  IsString, IsOptional, IsArray, IsNumber,
  ValidateNested, Min, IsIn, IsObject,
} from 'class-validator'
import { Type } from 'class-transformer'

// FE gửi: { product_id, product_name?, qty, price }
export class OrderItemDto {
  @IsNumber()
  product_id: number

  /** Tên sản phẩm (FE gửi thêm, không dùng — lấy từ DB) */
  @IsString()
  @IsOptional()
  product_name?: string

  /** Số lượng — FE gửi qty */
  @IsNumber()
  @Min(1)
  qty: number

  @IsNumber()
  @Min(0)
  price: number
}

// FE gửi nhiều field snake_case. Tất cả phải khai báo vì forbidNonWhitelisted=true.
export class CreateOrderDto {
  @IsString()
  customer_name: string

  @IsString()
  customer_phone: string

  @IsString()
  @IsOptional()
  customer_email?: string

  /** FE gửi customer_address (không phải shipping_address) */
  @IsString()
  @IsOptional()
  customer_address?: string

  /** Giữ backward compat nếu FE gửi shipping_address */
  @IsString()
  @IsOptional()
  shipping_address?: string

  @IsString()
  @IsOptional()
  payment_method?: string

  @IsString()
  @IsOptional()
  note?: string

  /** Loại đơn hàng */
  @IsString()
  @IsOptional()
  type?: string

  /** Phương thức giao hàng */
  @IsString()
  @IsOptional()
  delivery_method?: string

  /** ID chi nhánh nhận tại chỗ */
  @IsNumber()
  @IsOptional()
  pickup_branch_id?: number

  /** Kho thực hiện */
  @IsString()
  @IsOptional()
  fulfilling_warehouse?: string

  /** Toạ độ khách hàng */
  @IsOptional()
  customer_coords?: unknown

  /** Subtotal (FE tính sẵn, BE tính lại từ items) */
  @IsNumber()
  @IsOptional()
  subtotal?: number

  /** Phí ship */
  @IsNumber()
  @IsOptional()
  shipping_fee?: number

  /** Total (FE tính sẵn) */
  @IsNumber()
  @IsOptional()
  total?: number

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[]
}
