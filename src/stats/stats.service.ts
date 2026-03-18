// src/stats/stats.service.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(range: string = '30d') {
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
}