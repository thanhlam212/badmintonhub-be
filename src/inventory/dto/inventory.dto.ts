import { IsInt, IsString, IsOptional, IsNotEmpty, IsNumber, Min } from 'class-validator'
import { Type } from 'class-transformer'

// FE gửi: { sku, warehouseId (camelCase), qty, cost?, note? }
export class ImportStockDto {
  /** ID kho nhập hàng — FE gửi camelCase */
  @Type(() => Number)
  @IsInt({ message: 'warehouseId phải là số nguyên' })
  @Min(1)
  warehouseId: number

  /** Mã SKU sản phẩm */
  @IsString()
  @IsNotEmpty({ message: 'sku không được để trống' })
  sku: string

  /** Số lượng nhập — FE gửi qty */
  @Type(() => Number)
  @IsInt({ message: 'qty phải là số nguyên' })
  @Min(1, { message: 'qty phải >= 1' })
  qty: number

  /** Giá nhập (FE có thể gửi, BE bỏ qua — dùng unitCost từ inventory) */
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  cost?: number

  /** Ghi chú (tuỳ chọn) */
  @IsString()
  @IsOptional()
  note?: string
}

export class ExportStockDto {
  /** ID kho xuất hàng — FE gửi camelCase */
  @Type(() => Number)
  @IsInt({ message: 'warehouseId phải là số nguyên' })
  @Min(1)
  warehouseId: number

  /** Mã SKU sản phẩm */
  @IsString()
  @IsNotEmpty({ message: 'sku không được để trống' })
  sku: string

  /** Số lượng xuất — FE gửi qty */
  @Type(() => Number)
  @IsInt({ message: 'qty phải là số nguyên' })
  @Min(1, { message: 'qty phải >= 1' })
  qty: number

  /** Ghi chú (tuỳ chọn) */
  @IsString()
  @IsOptional()
  note?: string
}
