// ═══════════════════════════════════════════════════════════════
// src/products/dto/product.dto.ts
// ═══════════════════════════════════════════════════════════════
import {
  IsString, IsNumber, IsOptional, IsBoolean, Min, IsNotEmpty, IsArray,
} from 'class-validator'
import { Transform, Type } from 'class-transformer'

export class QueryProductDto {
  @IsOptional()
  @IsString()
  category?: string

  @IsOptional()
  @IsString()
  brand?: string

  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsString()
  gender?: string  // 'male' | 'female' | 'unisex'

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  limit?: number

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  page?: number

  @IsOptional()
  @IsString()
  sortBy?: string  // 'price-asc' | 'price-desc' | 'rating' | 'newest'

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  minPrice?: number

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  maxPrice?: number
}

// ─── Tạo sản phẩm ──────────────────────────────────────────────
export class CreateProductDto {
  @IsString()
  @IsOptional()
  sku?: string

  @IsString()
  @IsNotEmpty()
  name: string

  @IsString()
  @IsNotEmpty()
  brand: string

  @IsString()
  @IsNotEmpty()
  category: string

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  original_price?: number | null

  @IsString()
  @IsOptional()
  image?: string | null

  @IsString()
  @IsOptional()
  description?: string

  @IsOptional()
  specs?: Record<string, any>

  @IsArray()
  @IsOptional()
  features?: string[]

  @IsBoolean()
  @IsOptional()
  in_stock?: boolean

  @IsString()
  @IsOptional()
  gender?: string | null

  @IsArray()
  @IsOptional()
  badges?: string[]
}

// ─── Cập nhật sản phẩm ─────────────────────────────────────────
export class UpdateProductDto {
  @IsString()
  @IsOptional()
  name?: string

  @IsString()
  @IsOptional()
  brand?: string

  @IsString()
  @IsOptional()
  category?: string

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  price?: number

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  original_price?: number | null

  @IsString()
  @IsOptional()
  image?: string | null

  @IsString()
  @IsOptional()
  description?: string

  @IsOptional()
  specs?: Record<string, any>

  @IsArray()
  @IsOptional()
  features?: string[]

  @IsBoolean()
  @IsOptional()
  in_stock?: boolean

  @IsString()
  @IsOptional()
  gender?: string | null
}