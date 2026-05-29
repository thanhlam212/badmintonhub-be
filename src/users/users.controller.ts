import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common'
import { UsersService } from './users.service'
import { CreateUserDto, UpdateUserDto, ResetPasswordDto } from './dto/user.dto'
import { Roles } from 'src/auth/decorators'

// Global JwtAuthGuard + RolesGuard applied via APP_GUARD
@Controller('users')
@Roles('admin')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // GET /users?role=admin&search=nguyen&page=1&limit=20
  @Get()
  findAll(
    @Query('role')   role?: string,
    @Query('search') search?: string,
    @Query('page')   page?: string,
    @Query('limit')  limit?: string,
  ) {
    return this.usersService.findAll({
      role,
      search,
      page:  page  ? +page  : 1,
      limit: limit ? +limit : 20,
    })
  }

  // GET /users/:id
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id)
  }

  // POST /users
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto)
  }

  // PUT /users/:id
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto)
  }

  // PUT /users/:id/password — phải đứng TRƯỚC :id để không conflict
  // NestJS processes static paths before dynamic, so 'password' won't match ':id'
  // Actually NestJS uses first-match, so PUT :id/password needs explicit path
  @Put(':id/password')
  resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.usersService.resetPassword(id, dto)
  }

  // DELETE /users/:id
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id)
  }
}
