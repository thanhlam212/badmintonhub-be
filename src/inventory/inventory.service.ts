import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  // GET /inventory — lấy tồn kho (lọc theo warehouse của employee)
  async getAll(user: any) {
    const where = user.role === 'employee' && user.warehouseId
      ? `WHERE i.warehouse_id = ${user.warehouseId}`
      : ''

    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT i.*, w.name AS warehouse_name, w.id AS warehouse_id
      FROM inventory i
      JOIN warehouses w ON w.id = i.warehouse_id
      ${where}
      ORDER BY i.category, i.name
    `)
    return rows
  }

  // GET /inventory/low-stock
  async getLowStock(user: any) {
    const where = user.role === 'employee' && user.warehouseId
      ? `AND i.warehouse_id = ${user.warehouseId}`
      : ''

    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT i.*, w.name AS warehouse_name
      FROM inventory i
      JOIN warehouses w ON w.id = i.warehouse_id
      WHERE i.available <= i.reorder_point ${where}
      ORDER BY i.available ASC
    `)
    return rows
  }

  // GET /inventory/transactions
  async getTransactions(user: any) {
    const where = user.role === 'employee' && user.warehouseId
      ? `WHERE t.warehouse_id = ${user.warehouseId}`
      : ''

    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT t.*, w.name AS warehouse_name
      FROM inventory_transactions t
      JOIN warehouses w ON w.id = t.warehouse_id
      ${where}
      ORDER BY t.date DESC
      LIMIT 200
    `)
    return rows
  }

  // POST /inventory/import — nhập kho
  async importStock(dto: { warehouse_id: number; sku: string; quantity: number; note?: string }, user: any) {
    const { warehouse_id, sku, quantity, note } = dto

    // Cập nhật tồn kho
    const updated = await this.prisma.$executeRawUnsafe(`
      UPDATE inventory
      SET on_hand = on_hand + ${quantity},
          available = available + ${quantity},
          updated_at = NOW()
      WHERE warehouse_id = ${warehouse_id} AND sku = '${sku}'
    `)

    if (updated === 0) {
      throw new BadRequestException(`SKU ${sku} không tồn tại trong kho ${warehouse_id}`)
    }

    // Ghi lịch sử
    await this.prisma.$executeRawUnsafe(`
      INSERT INTO inventory_transactions (type, date, sku, warehouse_id, qty, cost, note, operator)
      SELECT 'import', NOW(), '${sku}', ${warehouse_id}, ${quantity}, unit_cost,
             '${(note || '').replace(/'/g, "''")}', '${user.fullName || user.username}'
      FROM inventory WHERE warehouse_id = ${warehouse_id} AND sku = '${sku}'
    `)

    return { success: true, message: 'Nhập kho thành công' }
  }

  // POST /inventory/export — xuất kho
  async exportStock(dto: { warehouse_id: number; sku: string; quantity: number; note?: string }, user: any) {
    const { warehouse_id, sku, quantity, note } = dto

    // Kiểm tra tồn kho
    const inv = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT available FROM inventory WHERE warehouse_id = ${warehouse_id} AND sku = '${sku}'
    `)
    if (!inv.length) throw new BadRequestException(`SKU ${sku} không tồn tại trong kho`)
    if (inv[0].available < quantity) throw new BadRequestException(`Không đủ hàng: còn ${inv[0].available}, cần ${quantity}`)

    await this.prisma.$executeRawUnsafe(`
      UPDATE inventory
      SET on_hand = on_hand - ${quantity},
          available = available - ${quantity},
          updated_at = NOW()
      WHERE warehouse_id = ${warehouse_id} AND sku = '${sku}'
    `)

    await this.prisma.$executeRawUnsafe(`
      INSERT INTO inventory_transactions (type, date, sku, warehouse_id, qty, cost, note, operator)
      SELECT 'export', NOW(), '${sku}', ${warehouse_id}, ${quantity}, unit_cost,
             '${(note || '').replace(/'/g, "''")}', '${user.fullName || user.username}'
      FROM inventory WHERE warehouse_id = ${warehouse_id} AND sku = '${sku}'
    `)

    return { success: true, message: 'Xuất kho thành công' }
  }
}