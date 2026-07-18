// src/stats/stats.service.ts
import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export const VALID_RANGES = ['7d', '30d', 'month', 'today'] as const
export type StatsRange = typeof VALID_RANGES[number]
const EMPLOYEE_REPORT_RANGES = ['today', 'week', 'month', '30d', 'date', 'custom'] as const
type EmployeeReportRange = typeof EMPLOYEE_REPORT_RANGES[number]

const PAID_BOOKING_STATUSES = ['confirmed', 'playing', 'completed'] as const
const ACTIVE_ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipping', 'delivered'] as const
const PAID_SALES_ORDER_STATUSES = ['approved', 'exported'] as const

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(range: string = '30d') {
    if (!VALID_RANGES.includes(range as StatsRange)) {
      throw new BadRequestException(
        `range không hợp lệ: "${range}". Chỉ chấp nhận: ${VALID_RANGES.join(', ')}`
      )
    }

    const now = new Date()
    const from = this.getFromDate(range, now)
    const prevFrom = this.getFromDate(range, from) // kỳ trước để tính % tăng trưởng

    const [
      // Kỳ hiện tại
      bookingRevenue,
      orderRevenue,
      totalBookings,
      totalOrders,
      totalUsers,
      // Kỳ trước
      prevBookingRevenue,
      prevOrderRevenue,
      // Chi tiết
      weeklyRevenue,
      topCourts,
      topProducts,
      hourlyDistribution,
      paymentMethods,
    ] = await Promise.all([
      // Doanh thu đặt sân (confirmed/completed)
      this.prisma.booking.aggregate({
        where: { createdAt: { gte: from }, status: { in: ['confirmed', 'completed', 'playing'] } },
        _sum: { amount: true },
      }),
      // Doanh thu shop (orders)
      this.prisma.order.aggregate({
        where: { createdAt: { gte: from }, status: { notIn: ['cancelled'] } },
        _sum: { total: true },
      }),
      // Tổng booking
      this.prisma.booking.count({
        where: { createdAt: { gte: from } },
      }),
      // Tổng đơn hàng
      this.prisma.order.count({
        where: { createdAt: { gte: from }, status: { notIn: ['cancelled'] } },
      }),
      // Tổng khách hàng mới
      this.prisma.user.count({
        where: { createdAt: { gte: from }, role: 'user' },
      }),

      // Kỳ trước — booking revenue
      this.prisma.booking.aggregate({
        where: { createdAt: { gte: prevFrom, lt: from }, status: { in: ['confirmed', 'completed', 'playing'] } },
        _sum: { amount: true },
      }),
      // Kỳ trước — order revenue
      this.prisma.order.aggregate({
        where: { createdAt: { gte: prevFrom, lt: from }, status: { notIn: ['cancelled'] } },
        _sum: { total: true },
      }),

      // Doanh thu 7 ngày gần nhất (từng ngày)
      this.getWeeklyRevenue(),

      // Top 5 sân theo doanh thu
      this.getTopCourts(from),

      // Top 5 sản phẩm bán chạy
      this.getTopProducts(from),

      // Phân bổ booking theo giờ
      this.getHourlyDistribution(from),

      // Phương thức thanh toán
      this.getPaymentMethods(from),
    ])

    const bookingRev = parseFloat(String(bookingRevenue._sum.amount || 0))
    const shopRev = parseFloat(String(orderRevenue._sum.total || 0))
    const totalRev = bookingRev + shopRev

    const prevBookingRev = parseFloat(String(prevBookingRevenue._sum.amount || 0))
    const prevShopRev = parseFloat(String(prevOrderRevenue._sum.total || 0))
    const prevTotalRev = prevBookingRev + prevShopRev

    const growthRate = prevTotalRev > 0
      ? Math.round(((totalRev - prevTotalRev) / prevTotalRev) * 100)
      : 0

    return {
      kpis: {
        totalRevenue: totalRev,
        bookingRevenue: bookingRev,
        shopRevenue: shopRev,
        growthRate,
        totalBookings,
        totalOrders,
        totalUsers,
      },
      weeklyRevenue,
      topCourts,
      topProducts,
      hourlyDistribution,
      paymentMethods,
    }
  }

  async getEmployeeReport(user: any, range: string = 'today', branchId?: string, fromDate?: string, toDate?: string) {
    if (!EMPLOYEE_REPORT_RANGES.includes(range as EmployeeReportRange)) {
      throw new BadRequestException(
        `range không hợp lệ: "${range}". Chỉ chấp nhận: ${EMPLOYEE_REPORT_RANGES.join(', ')}`
      )
    }

    const branch = await this.resolveReportBranch(user, branchId)
    const { from, to, previousFrom, previousTo, label } = this.getReportWindow(range, fromDate, toDate)
    const branchWarehouseIds = branch.id
      ? (await this.prisma.warehouse.findMany({
          where: { branchId: branch.id },
          select: { id: true },
        })).map((warehouse) => warehouse.id)
      : []

    const bookingWhere: any = {
      createdAt: { gte: from, lte: to },
      ...(branch.id ? { branchId: branch.id } : {}),
    }
    const paidBookingWhere: any = {
      ...bookingWhere,
      status: { in: [...PAID_BOOKING_STATUSES] },
    }
    const previousPaidBookingWhere: any = {
      createdAt: { gte: previousFrom, lte: previousTo },
      status: { in: [...PAID_BOOKING_STATUSES] },
      ...(branch.id ? { branchId: branch.id } : {}),
    }

    const orderBranchFilter = this.buildOrderBranchFilter(branch.id, branchWarehouseIds)
    const orderWhere: any = {
      createdAt: { gte: from, lte: to },
      status: { in: [...ACTIVE_ORDER_STATUSES] },
      ...orderBranchFilter,
    }
    const previousOrderWhere: any = {
      createdAt: { gte: previousFrom, lte: previousTo },
      status: { in: [...ACTIVE_ORDER_STATUSES] },
      ...orderBranchFilter,
    }

    const salesOrderWhere: any = {
      createdAt: { gte: from, lte: to },
      status: { in: [...PAID_SALES_ORDER_STATUSES] },
      ...(branch.id ? { branchId: branch.id } : {}),
    }
    const previousSalesOrderWhere: any = {
      createdAt: { gte: previousFrom, lte: previousTo },
      status: { in: [...PAID_SALES_ORDER_STATUSES] },
      ...(branch.id ? { branchId: branch.id } : {}),
    }

    const [
      bookingRevenue,
      onlineRevenue,
      posRevenue,
      previousBookingRevenue,
      previousOnlineRevenue,
      previousPosRevenue,
      bookingCount,
      onlineOrderCount,
      posOrderCount,
      completedBookings,
      cancelledBookings,
      pendingBookings,
      deliveredOrders,
      pendingOrders,
      topCourts,
      topProducts,
      dailySeries,
      paymentMethods,
      branchRevenue,
    ] = await Promise.all([
      this.prisma.booking.aggregate({ where: paidBookingWhere, _sum: { amount: true } }),
      this.prisma.order.aggregate({ where: orderWhere, _sum: { total: true } }),
      this.prisma.salesOrder.aggregate({ where: salesOrderWhere, _sum: { finalTotal: true } }),
      this.prisma.booking.aggregate({ where: previousPaidBookingWhere, _sum: { amount: true } }),
      this.prisma.order.aggregate({ where: previousOrderWhere, _sum: { total: true } }),
      this.prisma.salesOrder.aggregate({ where: previousSalesOrderWhere, _sum: { finalTotal: true } }),
      this.prisma.booking.count({ where: bookingWhere }),
      this.prisma.order.count({ where: orderWhere }),
      this.prisma.salesOrder.count({ where: salesOrderWhere }),
      this.prisma.booking.count({ where: { ...bookingWhere, status: 'completed' } }),
      this.prisma.booking.count({ where: { ...bookingWhere, status: 'cancelled' } }),
      this.prisma.booking.count({ where: { ...bookingWhere, status: { in: ['pending', 'deposited', 'confirmed'] } } }),
      this.prisma.order.count({ where: { ...orderWhere, status: 'delivered' } }),
      this.prisma.order.count({ where: { ...orderWhere, status: { in: ['pending', 'confirmed', 'processing', 'shipping'] } } }),
      this.getEmployeeTopCourts(from, to, branch.id),
      this.getEmployeeTopProducts(from, to, branch.id, branchWarehouseIds),
      this.getEmployeeDailySeries(from, to, branch.id, branchWarehouseIds),
      this.getEmployeePaymentMethods(from, to, branch.id, branchWarehouseIds),
      this.getBranchRevenue(from, to, branch.id),
    ])

    const bookingRev = this.toNumber(bookingRevenue._sum.amount)
    const onlineRev = this.toNumber(onlineRevenue._sum.total)
    const posRev = this.toNumber(posRevenue._sum.finalTotal)
    const totalRevenue = bookingRev + onlineRev + posRev

    const previousRevenue =
      this.toNumber(previousBookingRevenue._sum.amount) +
      this.toNumber(previousOnlineRevenue._sum.total) +
      this.toNumber(previousPosRevenue._sum.finalTotal)

    const growthRate = previousRevenue > 0
      ? Math.round(((totalRevenue - previousRevenue) / previousRevenue) * 100)
      : 0

    return {
      range,
      label,
      branch,
      period: {
        from: this.formatDateKey(from),
        to: this.formatDateKey(to),
        description: `${label}: ${this.formatDateKey(from)} → ${this.formatDateKey(to)}`,
      },
      kpis: {
        totalRevenue,
        bookingRevenue: bookingRev,
        onlineRevenue: onlineRev,
        posRevenue: posRev,
        growthRate,
        totalBookings: bookingCount,
        totalOrders: onlineOrderCount + posOrderCount,
        onlineOrders: onlineOrderCount,
        posOrders: posOrderCount,
        completedBookings,
        cancelledBookings,
        pendingBookings,
        deliveredOrders,
        pendingOrders,
      },
      dailySeries,
      topCourts,
      topProducts,
      paymentMethods,
      branchRevenue,
    }
  }

  // ─── Doanh thu 7 ngày ─────────────────────────
  private async getWeeklyRevenue() {
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
    const result: { day: string; booking: number; shop: number }[] = []

    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const start = new Date(date.setHours(0, 0, 0, 0))
      const end = new Date(date.setHours(23, 59, 59, 999))

      const [bookingRev, shopRev] = await Promise.all([
        this.prisma.booking.aggregate({
          where: { createdAt: { gte: start, lte: end }, status: { in: ['confirmed', 'completed', 'playing'] } },
          _sum: { amount: true },
        }),
        this.prisma.order.aggregate({
          where: { createdAt: { gte: start, lte: end }, status: { notIn: ['cancelled'] } },
          _sum: { total: true },
        }),
      ])

      result.push({
        day: days[start.getDay()],
        booking: parseFloat(String(bookingRev._sum.amount || 0)),
        shop: parseFloat(String(shopRev._sum.total || 0)),
      })
    }

    return result
  }

  // ─── Top sân ──────────────────────────────────
  private async getTopCourts(from: Date) {
    const bookings = await this.prisma.booking.findMany({
      where: { createdAt: { gte: from }, status: { in: ['confirmed', 'completed', 'playing'] } },
      include: { court: { select: { name: true } } },
    })

    const courtMap = new Map<string, { name: string; revenue: number; bookings: number }>()
    for (const b of bookings) {
      const name = b.court?.name || 'Unknown'
      const existing = courtMap.get(name) || { name, revenue: 0, bookings: 0 }
      existing.revenue += parseFloat(String(b.amount || 0))
      existing.bookings += 1
      courtMap.set(name, existing)
    }

    return Array.from(courtMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
  }

  // ─── Top sản phẩm ─────────────────────────────
  private async getTopProducts(from: Date) {
    const items = await this.prisma.orderItem.findMany({
      where: { order: { createdAt: { gte: from }, status: { notIn: ['cancelled'] } } },
      include: { product: { select: { name: true } } },
    })

    const productMap = new Map<string, { name: string; qty: number; revenue: number }>()
    for (const item of items) {
      const name = item.productName || item.product?.name || 'Unknown'
      const existing = productMap.get(name) || { name, qty: 0, revenue: 0 }
      existing.qty += item.qty
      existing.revenue += parseFloat(String(item.price)) * item.qty
      productMap.set(name, existing)
    }

    return Array.from(productMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
  }

  // ─── Phân bổ theo giờ ─────────────────────────
  private async getHourlyDistribution(from: Date) {
    const bookings = await this.prisma.booking.findMany({
      where: { createdAt: { gte: from } },
      select: { timeStart: true },
    })

    const hourMap = new Map<string, number>()
    for (let h = 6; h <= 21; h++) {
      hourMap.set(`${String(h).padStart(2, '0')}:00`, 0)
    }

    for (const b of bookings) {
      if (!b.timeStart) continue
      const hour = b.timeStart.substring(0, 5)
      if (hourMap.has(hour)) {
        hourMap.set(hour, (hourMap.get(hour) || 0) + 1)
      }
    }

    return Array.from(hourMap.entries()).map(([hour, bookings]) => ({ hour, bookings }))
  }

  // ─── Phương thức thanh toán ───────────────────
  private async getPaymentMethods(from: Date) {
    const bookings = await this.prisma.booking.findMany({
      where: { createdAt: { gte: from } },
      select: { paymentMethod: true },
    })
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: from }, status: { notIn: ['cancelled'] } },
      select: { paymentMethod: true },
    })

    const methodMap = new Map<string, number>()
    for (const b of [...bookings, ...orders]) {
      const method = b.paymentMethod || 'other'
      methodMap.set(method, (methodMap.get(method) || 0) + 1)
    }

    const total = Array.from(methodMap.values()).reduce((s, v) => s + v, 0)
    const colors: Record<string, string> = {
      momo: '#d63384', vnpay: '#0d6efd', bank: '#0dcaf0',
      cod: '#198754', wallet: '#fd7e14', other: '#6c757d',
    }

    return Array.from(methodMap.entries()).map(([name, count]) => ({
      name: name.toUpperCase(),
      value: total > 0 ? Math.round((count / total) * 100) : 0,
      color: colors[name.toLowerCase()] || '#6c757d',
    }))
  }

  // ─── Helper ───────────────────────────────────
  private getFromDate(range: string, base: Date): Date {
    const d = new Date(base)
    if (range === '7d')  d.setDate(d.getDate() - 7)
    else if (range === '30d') d.setDate(d.getDate() - 30)
    else if (range === 'month') { d.setDate(1); d.setHours(0, 0, 0, 0) }
    else d.setHours(0, 0, 0, 0) // today
    return d
  }

  private async resolveReportBranch(user: any, branchId?: string) {
    if (user?.role === 'admin' && branchId) {
      const parsed = Number(branchId)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new BadRequestException('branchId không hợp lệ')
      }
      const branch = await this.prisma.branch.findUnique({
        where: { id: parsed },
        select: { id: true, name: true },
      })
      if (!branch) throw new BadRequestException('Không tìm thấy chi nhánh')
      return branch
    }

    if (user?.role === 'employee') {
      const employee = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: {
          warehouse: {
            select: {
              branch: { select: { id: true, name: true } },
            },
          },
        },
      })
      const branch = employee?.warehouse?.branch
      if (!branch) {
        throw new BadRequestException('Tài khoản nhân viên chưa gắn kho/chi nhánh')
      }
      return branch
    }

    return { id: null, name: 'Toàn hệ thống' }
  }

  private getReportWindow(range: string, fromDate?: string, toDate?: string) {
    const now = new Date()
    let from: Date
    let to: Date
    let label: string

    if (range === 'date') {
      const selected = this.parseDateOnly(fromDate || toDate || this.formatDateKey(now), 'from')
      from = this.startOfDay(selected)
      to = this.endOfDay(selected)
      label = 'Theo ngày'
    } else if (range === 'custom') {
      if (!fromDate || !toDate) {
        throw new BadRequestException('Vui lòng chọn từ ngày và đến ngày')
      }
      from = this.startOfDay(this.parseDateOnly(fromDate, 'from'))
      to = this.endOfDay(this.parseDateOnly(toDate, 'to'))
      if (to < from) throw new BadRequestException('Đến ngày phải lớn hơn hoặc bằng từ ngày')
      label = 'Khoảng ngày'
    } else if (range === 'today') {
      from = this.startOfDay(now)
      to = this.endOfDay(now)
      label = 'Hôm nay'
    } else if (range === 'week') {
      from = this.startOfWeek(now)
      to = this.endOfDay(now)
      label = 'Tuần này'
    } else if (range === 'month') {
      from = new Date(now)
      from.setDate(1)
      from = this.startOfDay(from)
      to = this.endOfDay(now)
      label = 'Tháng này'
    } else {
      from = this.startOfDay(now)
      from.setDate(from.getDate() - 29)
      to = this.endOfDay(now)
      label = '30 ngày'
    }

    const lengthMs = to.getTime() - from.getTime() + 1
    const previousTo = new Date(from.getTime() - 1)
    const previousFrom = new Date(previousTo.getTime() - lengthMs + 1)

    return { from, to, previousFrom, previousTo, label }
  }

  private parseDateOnly(value: string, fieldName: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${fieldName} phải có định dạng YYYY-MM-DD`)
    }
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${fieldName} không hợp lệ`)
    return date
  }

  private startOfDay(date: Date) {
    const result = new Date(date)
    result.setHours(0, 0, 0, 0)
    return result
  }

  private endOfDay(date: Date) {
    const result = new Date(date)
    result.setHours(23, 59, 59, 999)
    return result
  }

  private startOfWeek(date: Date) {
    const result = this.startOfDay(date)
    const day = result.getDay() || 7
    result.setDate(result.getDate() - day + 1)
    return result
  }

  private formatDateKey(date: Date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private toNumber(value: any) {
    return Number(value || 0)
  }

  private buildOrderBranchFilter(branchId: number | null, warehouseIds: number[]) {
    if (!branchId) return {}
    return {
      OR: [
        { pickupBranchId: branchId },
        ...(warehouseIds.length ? [{ fulfillingWarehouseId: { in: warehouseIds } }] : []),
      ],
    }
  }

  private eachDay(from: Date, to: Date) {
    const days: Date[] = []
    const cursor = this.startOfDay(from)
    const end = this.startOfDay(to)
    while (cursor <= end) {
      days.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    return days
  }

  private async getEmployeeDailySeries(from: Date, to: Date, branchId: number | null, warehouseIds: number[]) {
    const days = this.eachDay(from, to)
    return Promise.all(days.map(async (date) => {
      const start = this.startOfDay(date)
      const end = this.endOfDay(date)
      const orderBranchFilter = this.buildOrderBranchFilter(branchId, warehouseIds)
      const [bookingRev, onlineRev, posRev, bookings, orders, posOrders] = await Promise.all([
        this.prisma.booking.aggregate({
          where: {
            createdAt: { gte: start, lte: end },
            status: { in: [...PAID_BOOKING_STATUSES] },
            ...(branchId ? { branchId } : {}),
          },
          _sum: { amount: true },
        }),
        this.prisma.order.aggregate({
          where: {
            createdAt: { gte: start, lte: end },
            status: { in: [...ACTIVE_ORDER_STATUSES] },
            ...orderBranchFilter,
          },
          _sum: { total: true },
        }),
        this.prisma.salesOrder.aggregate({
          where: {
            createdAt: { gte: start, lte: end },
            status: { in: [...PAID_SALES_ORDER_STATUSES] },
            ...(branchId ? { branchId } : {}),
          },
          _sum: { finalTotal: true },
        }),
        this.prisma.booking.count({
          where: {
            createdAt: { gte: start, lte: end },
            ...(branchId ? { branchId } : {}),
          },
        }),
        this.prisma.order.count({
          where: {
            createdAt: { gte: start, lte: end },
            status: { in: [...ACTIVE_ORDER_STATUSES] },
            ...orderBranchFilter,
          },
        }),
        this.prisma.salesOrder.count({
          where: {
            createdAt: { gte: start, lte: end },
            status: { in: [...PAID_SALES_ORDER_STATUSES] },
            ...(branchId ? { branchId } : {}),
          },
        }),
      ])
      const booking = this.toNumber(bookingRev._sum.amount)
      const online = this.toNumber(onlineRev._sum.total)
      const pos = this.toNumber(posRev._sum.finalTotal)
      return {
        date: this.formatDateKey(date),
        label: date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
        booking,
        online,
        pos,
        total: booking + online + pos,
        bookings,
        orders: orders + posOrders,
      }
    }))
  }

  private async getEmployeeTopCourts(from: Date, to: Date, branchId: number | null) {
    const bookings = await this.prisma.booking.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { in: [...PAID_BOOKING_STATUSES] },
        ...(branchId ? { branchId } : {}),
      },
      select: { amount: true, court: { select: { name: true } } },
    })

    const courtMap = new Map<string, { name: string; revenue: number; bookings: number }>()
    for (const booking of bookings) {
      const name = booking.court?.name || 'Không rõ sân'
      const row = courtMap.get(name) || { name, revenue: 0, bookings: 0 }
      row.revenue += this.toNumber(booking.amount)
      row.bookings += 1
      courtMap.set(name, row)
    }
    return Array.from(courtMap.values()).sort((a, b) => b.revenue - a.revenue)
  }

  private async getEmployeeTopProducts(from: Date, to: Date, branchId: number | null, warehouseIds: number[]) {
    const orderBranchFilter = this.buildOrderBranchFilter(branchId, warehouseIds)
    const [onlineItems, posItems] = await Promise.all([
      this.prisma.orderItem.findMany({
        where: {
          order: {
            createdAt: { gte: from, lte: to },
            status: { in: [...ACTIVE_ORDER_STATUSES] },
            ...orderBranchFilter,
          },
        },
        select: { productName: true, price: true, qty: true },
      }),
      this.prisma.salesOrderItem.findMany({
        where: {
          salesOrder: {
            createdAt: { gte: from, lte: to },
            status: { in: [...PAID_SALES_ORDER_STATUSES] },
            ...(branchId ? { branchId } : {}),
          },
        },
        select: { productName: true, price: true, qty: true },
      }),
    ])

    const productMap = new Map<string, { name: string; qty: number; revenue: number }>()
    for (const item of [...onlineItems, ...posItems]) {
      const name = item.productName || 'Không rõ sản phẩm'
      const row = productMap.get(name) || { name, qty: 0, revenue: 0 }
      row.qty += item.qty
      row.revenue += this.toNumber(item.price) * item.qty
      productMap.set(name, row)
    }
    return Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 8)
  }

  private async getEmployeePaymentMethods(from: Date, to: Date, branchId: number | null, warehouseIds: number[]) {
    const orderBranchFilter = this.buildOrderBranchFilter(branchId, warehouseIds)
    const [bookings, orders, salesOrders] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          createdAt: { gte: from, lte: to },
          ...(branchId ? { branchId } : {}),
        },
        select: { paymentMethod: true },
      }),
      this.prisma.order.findMany({
        where: {
          createdAt: { gte: from, lte: to },
          status: { in: [...ACTIVE_ORDER_STATUSES] },
          ...orderBranchFilter,
        },
        select: { paymentMethod: true },
      }),
      this.prisma.salesOrder.findMany({
        where: {
          createdAt: { gte: from, lte: to },
          status: { in: [...PAID_SALES_ORDER_STATUSES] },
          ...(branchId ? { branchId } : {}),
        },
        select: { paymentMethod: true },
      }),
    ])

    const methodMap = new Map<string, number>()
    for (const row of [...bookings, ...orders, ...salesOrders]) {
      const method = row.paymentMethod || 'other'
      methodMap.set(method, (methodMap.get(method) || 0) + 1)
    }

    return Array.from(methodMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  }

  private async getBranchRevenue(from: Date, to: Date, onlyBranchId: number | null) {
    const branches = await this.prisma.branch.findMany({
      where: onlyBranchId ? { id: onlyBranchId } : undefined,
      select: { id: true, name: true, warehouses: { select: { id: true } } },
      orderBy: { id: 'asc' },
    })

    return Promise.all(branches.map(async (branch) => {
      const warehouseIds = branch.warehouses.map((warehouse) => warehouse.id)
      const orderBranchFilter = this.buildOrderBranchFilter(branch.id, warehouseIds)
      const [bookingRev, onlineRev, posRev, bookings, onlineOrders, posOrders, courts] = await Promise.all([
        this.prisma.booking.aggregate({
          where: {
            createdAt: { gte: from, lte: to },
            status: { in: [...PAID_BOOKING_STATUSES] },
            branchId: branch.id,
          },
          _sum: { amount: true },
        }),
        this.prisma.order.aggregate({
          where: {
            createdAt: { gte: from, lte: to },
            status: { in: [...ACTIVE_ORDER_STATUSES] },
            ...orderBranchFilter,
          },
          _sum: { total: true },
        }),
        this.prisma.salesOrder.aggregate({
          where: {
            createdAt: { gte: from, lte: to },
            status: { in: [...PAID_SALES_ORDER_STATUSES] },
            branchId: branch.id,
          },
          _sum: { finalTotal: true },
        }),
        this.prisma.booking.count({
          where: { createdAt: { gte: from, lte: to }, branchId: branch.id },
        }),
        this.prisma.order.count({
          where: {
            createdAt: { gte: from, lte: to },
            status: { in: [...ACTIVE_ORDER_STATUSES] },
            ...orderBranchFilter,
          },
        }),
        this.prisma.salesOrder.count({
          where: {
            createdAt: { gte: from, lte: to },
            status: { in: [...PAID_SALES_ORDER_STATUSES] },
            branchId: branch.id,
          },
        }),
        this.getEmployeeTopCourts(from, to, branch.id),
      ])

      const bookingRevenue = this.toNumber(bookingRev._sum.amount)
      const onlineRevenue = this.toNumber(onlineRev._sum.total)
      const posRevenue = this.toNumber(posRev._sum.finalTotal)
      const storeRevenue = onlineRevenue + posRevenue

      return {
        branchId: branch.id,
        branchName: branch.name,
        bookingRevenue,
        onlineRevenue,
        posRevenue,
        storeRevenue,
        totalRevenue: bookingRevenue + storeRevenue,
        bookings,
        orders: onlineOrders + posOrders,
        courts,
      }
    }))
  }
}
