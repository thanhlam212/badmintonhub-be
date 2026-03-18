import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class TransfersService {
  constructor(private prisma: PrismaService) {}

  async getAll(user: any) {
    const where = user.role === 'employee' && user.warehouseId
      ? `WHERE (tr.from_warehouse_id = ${user.warehouseId} OR tr.to_warehouse_id = ${user.warehouseId})`
      : ''

    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT tr.*,
        fw.name AS from_warehouse_name,
        tw.name AS to_warehouse_name,
        u.full_name AS created_by_name,
        au.full_name AS approved_by_name,
        JSON_AGG(JSON_BUILD_OBJECT(
          'sku', ti.sku,
          'name', ti.name,
          'qty', ti.qty,
          'available', ti.available_at_request
        )) AS items
      FROM transfer_requests tr
      JOIN warehouses fw ON fw.id = tr.from_warehouse_id
      JOIN warehouses tw ON tw.id = tr.to_warehouse_id
      JOIN users u ON u.id = tr.created_by
      LEFT JOIN users au ON au.id = tr.approved_by
      LEFT JOIN transfer_items ti ON ti.transfer_id = tr.id
      ${where}
      GROUP BY tr.id, fw.name, tw.name, u.full_name, au.full_name
      ORDER BY tr.created_at DESC
    `)
    return rows
  }

  async create(dto: {
    from_warehouse_id: number
    to_warehouse_id: number
    note?: string
    items: { sku: string; quantity: number }[]
  }, user: any) {
    const { from_warehouse_id, to_warehouse_id, note, items } = dto

    // Tạo transfer request
    const result = await this.prisma.$queryRawUnsafe<any[]>(`
      INSERT INTO transfer_requests (date, from_warehouse_id, to_warehouse_id, reason, note, status, pickup_method, created_by)
      VALUES (NOW(), ${from_warehouse_id}, ${to_warehouse_id},
              '${(note || 'Điều chuyển kho').replace(/'/g, "''")}',
              '${(note || '').replace(/'/g, "''")}',
              'pending', 'employee', '${user.id}')
      RETURNING id
    `)
    const transferId = result[0].id

    // Thêm items
    for (const item of items) {
      // Lấy tên sản phẩm + available
      const inv = await this.prisma.$queryRawUnsafe<any[]>(`
        SELECT name, available FROM inventory
        WHERE warehouse_id = ${from_warehouse_id} AND sku = '${item.sku}'
      `)
      const name = inv[0]?.name || item.sku
      const available = inv[0]?.available || 0

      await this.prisma.$executeRawUnsafe(`
        INSERT INTO transfer_items (transfer_id, sku, name, qty, available_at_request)
        VALUES ('${transferId}', '${item.sku}', '${name.replace(/'/g, "''")}', ${item.quantity}, ${available})
      `)
    }

    return { success: true, data: { id: transferId } }
  }

  async updateStatus(id: string, status: string, user: any) {
    const validStatuses = ['pending', 'approved', 'in-transit', 'in_transit', 'completed', 'rejected']
    if (!validStatuses.includes(status)) throw new BadRequestException('Trạng thái không hợp lệ')

    // Normalize in-transit → in_transit cho DB
    const dbStatus = status === 'in-transit' ? 'in_transit' : status

    const approvedFields = status === 'approved'
      ? `, approved_by = '${user.id}', approved_at = NOW()`
      : ''
    const completedFields = status === 'completed'
      ? `, completed_at = NOW()`
      : ''

    await this.prisma.$executeRawUnsafe(`
      UPDATE transfer_requests
      SET status = '${dbStatus}' ${approvedFields} ${completedFields}
      WHERE id = '${id}'
    `)

    return { success: true, message: 'Cập nhật trạng thái thành công' }
  }
}