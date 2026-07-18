import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
  Min,
  ValidateNested,
} from 'class-validator'
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

export class AdminSlipItemDto {
  @IsString()
  @IsNotEmpty({ message: 'sku khong duoc de trong' })
  sku: string

  @IsString()
  @IsOptional()
  name?: string

  @Type(() => Number)
  @IsInt({ message: 'qty phai la so nguyen' })
  @Min(1, { message: 'qty phai >= 1' })
  qty: number

  @Type(() => Number)
  @IsNumber({}, { message: 'unitCost phai la so' })
  @Min(0, { message: 'unitCost phai >= 0' })
  unitCost: number
}

export class CreateAdminSlipDto {
  @IsIn(['import', 'export'], { message: 'type chi chap nhan import hoac export' })
  type: 'import' | 'export'

  @IsString()
  @IsOptional()
  poId?: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  supplierId?: number

  @Type(() => Number)
  @IsInt({ message: 'warehouseId phai la so nguyen' })
  @Min(1)
  warehouseId: number

  @IsString()
  @IsOptional()
  note?: string

  @IsString()
  @IsOptional()
  assignedTo?: string

  @IsArray()
  @ArrayMinSize(1, { message: 'Phai co it nhat 1 san pham' })
  @ValidateNested({ each: true })
  @Type(() => AdminSlipItemDto)
  items: AdminSlipItemDto[]
}
