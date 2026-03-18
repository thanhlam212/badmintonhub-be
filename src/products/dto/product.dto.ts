// ═══════════════════════════════════════════════════════════════
// src/products/dto/product.dto.ts
// ═══════════════════════════════════════════════════════════════
import { IsString, IsNumber, IsOptional, IsBoolean, Min } from 'class-validator'
import { Transform } from 'class-transformer'

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