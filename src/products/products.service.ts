// src/products/products.service.ts
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { QueryProductDto } from './dto/product.dto'

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

    return {
      products: products.map(this.transform),
      total,
      page,
      totalPages: Math.ceil(total / limit),
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

  private transform(raw: any) {
    return {
      id:            raw.id,
      sku:           raw.sku,
      name:          raw.name,
      brand:         raw.brand,
      category:      raw.category,
      price:         parseFloat(String(raw.price)),
      originalPrice: raw.originalPrice ? parseFloat(String(raw.originalPrice)) : null,
      rating:        parseFloat(String(raw.rating || 0)),
      reviews:       raw.reviewsCount || raw._count?.reviews || 0,
      image:         raw.images?.[0]?.url || raw.image || null,
      images:        raw.images?.map((i: any) => i.url) || [],
      description:   raw.description || '',
      specs:         raw.specs || {},
      features:      raw.features || [],
      inStock:       raw.inStock,
      gender:        raw.gender,
      badges:        raw.badges?.map((b: any) => b.badge) || [],
    }
  }
}