// src/products/products.controller.ts
import {
  Controller, Get, Post, Put, Delete,
  Param, Query, Body, ParseIntPipe,
  UploadedFile, UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { extname, join } from 'path'
import * as fs from 'fs'
import { ProductsService } from './products.service'
import { QueryProductDto, CreateProductDto, UpdateProductDto } from './dto/product.dto'
import { Public, Roles } from '../auth/decorators/index'

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // GET /api/products?category=vợt&brand=Yonex&sortBy=rating&limit=20
  @Public()
  @Get()
  findAll(@Query() query: QueryProductDto) {
    return this.productsService.findAll(query)
  }

  // GET /api/products/categories
  @Public()
  @Get('categories')
  getCategories() {
    return this.productsService.getCategories()
  }

  // GET /api/products/brands
  @Public()
  @Get('brands')
  getBrands() {
    return this.productsService.getBrands()
  }

  // POST /api/products/upload-image — Admin uploads product image
  @Roles('admin', 'employee')
  @Post('upload-image')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = join(process.cwd(), 'uploads', 'products')
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
          cb(null, dir)
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
          cb(null, `${unique}${extname(file.originalname)}`)
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) return { success: false, message: 'Không có file ảnh' }
    const url = `/uploads/products/${file.filename}`
    return { success: true, data: { url } }
  }

  // GET /api/products/:id
  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.findOne(id)
  }

  // POST /api/products — Admin creates product
  @Roles('admin')
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto)
  }

  // PUT /api/products/:id — Admin updates product
  @Roles('admin')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto)
  }

  // DELETE /api/products/:id — Admin deletes product
  @Roles('admin')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.remove(id)
  }
}
