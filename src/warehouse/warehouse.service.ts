import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class WarehouseService {
  constructor(private prisma: PrismaService) {}

  async getWarehouses() {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, name, branch_id, is_active FROM warehouses WHERE is_active = true ORDER BY id
    `
    return rows
  }

  async getSuppliers() {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, name, contact_person, phone, email FROM suppliers WHERE is_active = true ORDER BY name
    `
    return rows
  }
}