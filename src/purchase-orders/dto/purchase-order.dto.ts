import {
  IsInt,
  IsString,
  IsOptional,
  IsNotEmpty,
  IsIn,
  IsArray,
  IsNumber,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator'
import { Type } from 'class-transformer'

// FE gửi: { sku, quantity, price }
export class PoItemDto {
  @IsString()
  @IsNotEmpty({ message: 'sku không được để trống' })
  sku: string

  /** Số lượng đặt — FE gửi quantity */
  @Type(() => Number)
  @IsInt({ message: 'quantity phải là số nguyên' })
  @Min(1, { message: 'quantity phải >= 1' })
  quantity: number

  /** Đơn giá — FE gửi price */
  @Type(() => Number)
  @IsNumber({}, { message: 'price phải là số' })
  @Min(0, { message: 'price phải >= 0' })
  price: number
}

// FE gửi: { supplier_id, warehouse_id, note?, items: [...] }
export class CreatePurchaseOrderDto {
  /** ID nhà cung cấp — FE gửi snake_case */
  @Type(() => Number)
  @IsInt({ message: 'supplier_id phải là số nguyên' })
  @Min(1)
  supplier_id: number

  /** ID kho nhận hàng — FE gửi snake_case */
  @Type(() => Number)
  @IsInt({ message: 'warehouse_id phải là số nguyên' })
  @Min(1)
  warehouse_id: number

  @IsString()
  @IsOptional()
  note?: string

  @IsArray()
  @ArrayMinSize(1, { message: 'Phải có ít nhất 1 sản phẩm' })
  @ValidateNested({ each: true })
  @Type(() => PoItemDto)
  items: PoItemDto[]
}

export class UpdatePOStatusDto {
  @IsString()
  @IsIn(['sent', 'confirmed', 'shipping', 'received', 'cancelled'], {
    message: 'Trạng thái không hợp lệ. Chỉ chấp nhận: sent, confirmed, shipping, received, cancelled',
  })
  status: string
}
