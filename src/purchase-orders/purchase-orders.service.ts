import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class PurchaseOrdersService {
  constructor(private prisma: PrismaService) {}

  async getAll(user: any) {
    const where = user.role === 'employee' && user.warehouseId
      ? `WHERE po.warehouse_id = ${user.warehouseId}`
      : ''

    const rows = await this.prisma.$queryRawUnsafe(`
      SELECT po.*,
        s.name AS supplier_name,
        w.name AS warehouse_name,
        u.full_name AS created_by_name,
        COUNT(poi.po_id) AS item_count,
        JSON_AGG(JSON_BUILD_OBJECT(
          'sku', poi.sku,
          'name', poi.name,
          'qty', poi.qty,
          'unit_cost', poi.unit_cost
        )) FILTER (WHERE poi.po_id IS NOT NULL) AS po_items
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      JOIN warehouses w ON w.id = po.warehouse_id
      JOIN users u ON u.id = po.created_by
      LEFT JOIN po_items poi ON poi.po_id = po.id
      ${where}
      GROUP BY po.id, s.name, w.name, u.full_name
      ORDER BY po.created_at DESC
    `) as any[]
    return rows
  }

  async updateStatus(id: string, status: string) {
    await this.prisma.$executeRawUnsafe(`
      UPDATE purchase_orders SET status = '${status}', updated_at = NOW() WHERE id = '${id}'
    `)
    return { success: true, message: 'Cập nhật trạng thái thành công' }
  }

  async create(dto: { supplierId: number; warehouseId: number; note?: string; items: { sku: string; qty: number; unitCost: number }[] }, user: any) {
  const result = await this.prisma.$queryRawUnsafe(`
  INSERT INTO purchase_orders (id, supplier_id, warehouse_id, status, total_value, note, created_by)
  VALUES (gen_random_uuid(), ${dto.supplierId}, ${dto.warehouseId}, 'draft',
          ${dto.items.reduce((s: number, i: any) => s + i.qty * i.unitCost, 0)},
          '${(dto.note || '').replace(/'/g, "''")}', '${user.id}')
  RETURNING id
`) as any[]
  const poId = result[0].id
  for (const item of dto.items) {
    await this.prisma.$executeRawUnsafe(`
      INSERT INTO po_items (po_id, sku, name, qty, unit_cost)
      SELECT '${poId}', '${item.sku}', name, ${item.qty}, ${item.unitCost}
      FROM inventory WHERE sku = '${item.sku}' LIMIT 1
    `)
  }
  return { success: true, data: { id: poId } }
  }
}