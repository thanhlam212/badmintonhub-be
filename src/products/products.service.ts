// src/products/products.service.ts
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { QueryProductDto, CreateProductDto, UpdateProductDto } from './dto/product.dto'

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryProductDto) {
    const {
      category, brand, search, gender,
      limit = 20, page = 1,
      sortBy = 'newest',
      minPrice, maxPrice,
    } = query

    const where: any = { inStock: true }

    if (category) where.category = category
    if (brand)    where.brand    = { contains: brand, mode: 'insensitive' }
    if (gender)   where.gender   = gender
    if (search)   where.name     = { contains: search, mode: 'insensitive' }
    if (minPrice || maxPrice) {
      where.price = {}
      if (minPrice) where.price.gte = minPrice
      if (maxPrice) where.price.lte = maxPrice
    }

    const orderBy: any =
      sortBy === 'price-asc'  ? { price: 'asc' }  :
      sortBy === 'price-desc' ? { price: 'desc' } :
      sortBy === 'rating'     ? { rating: 'desc' } :
      { createdAt: 'desc' }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          badges:    { select: { badge: true } },
          images: { select: { url: true }, orderBy: { sortOrder: 'asc' } },
        },
      }),
      this.prisma.product.count({ where }),
    ])

    // Trả về { success: true, data: [...], pagination: {...} }
    // Interceptor sẽ pass-through vì có `success` field
    return {
      success: true,
      data: products.map(this.transform),
      pagination: {
        page,
        total,
        totalPages: Math.ceil(total / limit),
        limit,
      },
    }
  }

  async findOne(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        badges:    { select: { badge: true } },
        images: { select: { url: true }, orderBy: { sortOrder: 'asc' } },
      },
    })
    if (!product) throw new NotFoundException('Không tìm thấy sản phẩm')
    return this.transform(product)
  }

  async getCategories() {
    const cats = await this.prisma.product.findMany({
      where:    { inStock: true },
      select:   { category: true },
      distinct: ['category'],
    })
    return cats.map(c => c.category).filter(Boolean)
  }

  async getBrands() {
    const brands = await this.prisma.product.findMany({
      where:    { inStock: true },
      select:   { brand: true },
      distinct: ['brand'],
    })
    return brands.map(b => b.brand).filter(Boolean)
  }

  // ─── Admin CRUD ────────────────────────────────────────────────
  async create(dto: CreateProductDto) {
    // Tạo SKU nếu không cung cấp
    const sku = dto.sku || `SP${Date.now()}`
    const product = await this.prisma.product.create({
      data: {
        sku,
        name:          dto.name,
        brand:         dto.brand,
        category:      dto.category,
        price:         dto.price,
        originalPrice: dto.original_price ?? null,
        image:         dto.image ?? null,
        description:   dto.description ?? null,
        specs:         dto.specs ?? {},
        features:      dto.features ?? [],
        inStock:       dto.in_stock ?? true,
        gender:        (dto.gender as any) ?? null,
        badges:        dto.badges?.length
          ? { create: dto.badges.map(b => ({ badge: b })) }
          : undefined,
      },
      include: {
        badges: { select: { badge: true } },
        images: { select: { url: true }, orderBy: { sortOrder: 'asc' } },
      },
    })
    return this.transform(product)
  }

  async update(id: number, dto: UpdateProductDto) {
    await this.findOne(id)
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name          !== undefined && { name:          dto.name }),
        ...(dto.brand         !== undefined && { brand:         dto.brand }),
        ...(dto.category      !== undefined && { category:      dto.category }),
        ...(dto.price         !== undefined && { price:         dto.price }),
        ...(dto.original_price !== undefined && { originalPrice: dto.original_price }),
        ...(dto.image         !== undefined && { image:         dto.image }),
        ...(dto.description   !== undefined && { description:   dto.description }),
        ...(dto.specs         !== undefined && { specs:         dto.specs }),
        ...(dto.features      !== undefined && { features:      dto.features }),
        ...(dto.in_stock      !== undefined && { inStock:       dto.in_stock }),
        ...(dto.gender        !== undefined && { gender:        dto.gender as any }),
      },
      include: {
        badges: { select: { badge: true } },
        images: { select: { url: true }, orderBy: { sortOrder: 'asc' } },
      },
    })
    return this.transform(product)
  }

  async remove(id: number) {
    await this.findOne(id)
    await this.prisma.product.delete({ where: { id } })
    return { message: 'Đã xóa sản phẩm' }
  }

  // snake_case output — FE's transformProduct() đọc các field này
  private transform(raw: any) {
    return {
      id:             raw.id,
      sku:            raw.sku,
      name:           raw.name,
      brand:          raw.brand,
      category:       raw.category,
      price:          parseFloat(String(raw.price)),
      original_price: raw.originalPrice ? parseFloat(String(raw.originalPrice)) : null,
      rating:         parseFloat(String(raw.rating || 0)),
      reviews_count:  raw.reviewsCount || raw._count?.reviews || 0,
      image:          raw.images?.[0]?.url || raw.image || null,
      images:         raw.images?.map((i: any) => i.url) || [],
      description:    raw.description || '',
      specs:          raw.specs || {},
      features:       raw.features || [],
      in_stock:       raw.inStock,
      gender:         raw.gender,
      badges:         raw.badges?.map((b: any) => b.badge) || [],
      supplier_name:  null,  // bổ sung sau nếu cần
    }
  }
}