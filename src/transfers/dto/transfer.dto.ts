import {
  IsInt,
  IsString,
  IsOptional,
  IsNotEmpty,
  IsIn,
  IsArray,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator'
import { Type } from 'class-transformer'

export class TransferItemDto {
  /** Mã SKU sản phẩm */
  @IsString()
  @IsNotEmpty({ message: 'sku không được để trống' })
  sku: string

  /** Số lượng cần điều chuyển */
  @Type(() => Number)
  @IsInt({ message: 'quantity phải là số nguyên' })
  @Min(1, { message: 'quantity phải >= 1' })
  quantity: number
}

export class CreateTransferDto {
  /** ID kho nguồn */
  @Type(() => Number)
  @IsInt({ message: 'from_warehouse_id phải là số nguyên' })
  @Min(1)
  from_warehouse_id: number

  /** ID kho đích */
  @Type(() => Number)
  @IsInt({ message: 'to_warehouse_id phải là số nguyên' })
  @Min(1)
  to_warehouse_id: number

  /** Lý do / ghi chú điều chuyển (tuỳ chọn) */
  @IsString()
  @IsOptional()
  note?: string

  /** Danh sách sản phẩm điều chuyển */
  @IsArray()
  @ArrayMinSize(1, { message: 'Phải có ít nhất 1 sản phẩm' })
  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  items: TransferItemDto[]
}

export class UpdateTransferStatusDto {
  @IsString()
  @IsIn(['approved', 'rejected', 'in_transit', 'completed'], {
    message: 'Trạng thái không hợp lệ. Chỉ chấp nhận: approved, rejected, in_transit, completed',
  })
  status: string
}
