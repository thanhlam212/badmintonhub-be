// src/products/products.controller.ts
import { Controller, Get, Param, Query, ParseIntPipe } from '@nestjs/common'
import { ProductsService } from './products.service'
import { QueryProductDto } from './dto/product.dto'
import { Public } from '../auth/decorators/index'

@Public()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // GET /api/products?category=vợt&brand=Yonex&sortBy=rating&limit=20
  @Get()
  findAll(@Query() query: QueryProductDto) {
    return this.productsService.findAll(query)
  }

  // GET /api/products/categories
  @Get('categories')
  getCategories() {
    return this.productsService.getCategories()
  }

  // GET /api/products/brands
  @Get('brands')
  getBrands() {
    return this.productsService.getBrands()
  }

  // GET /api/products/:id
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.findOne(id)
  }
}