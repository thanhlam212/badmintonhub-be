import {
  Controller, Get, Post, Put, Patch,
  Body, Param, ParseIntPipe,
} from '@nestjs/common';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { Public, Roles } from '../auth/decorators/index';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  // GET /api/branches  (Public — khách cũng xem được)
  @Public()
  @Get()
  findAll() {
    return this.branchesService.findAll();
  }

  // GET /api/branches/:id  (Public)
  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.branchesService.findOne(id);
  }

  // POST /api/branches  (Admin only)
  @Roles('admin')
  @Post()
  create(@Body() dto: CreateBranchDto) {
    return this.branchesService.create(dto);
  }

  // PUT /api/branches/:id  (Admin only)
  @Roles('admin')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBranchDto) {
    return this.branchesService.update(id, dto);
  }

  // PATCH /api/branches/:id/toggle  (Admin only)
  @Roles('admin')
  @Patch(':id/toggle')
  toggle(@Param('id', ParseIntPipe) id: number) {
    return this.branchesService.toggle(id);
  }
}