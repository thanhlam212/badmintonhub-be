import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateBookingDto,
  FixedScheduleAdjustDto,
  FixedScheduleConfirmDto,
  FixedSchedulePreviewDto,
  UpdateBookingStatusDto,
} from './dto/booking.dto';
import { EmailService } from '../email/email.service';

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  private normalizeDate(value: string | Date) {
    const date = value instanceof Date ? new Date(value) : new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private formatDate(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private dayLabel(date: Date) {
    return `${date.getDate()}/${date.getMonth() + 1}`;
  }

  private buildHourSlots(timeStart: string, timeEnd: string) {
    const startHour = parseInt(timeStart.split(':')[0]);
    const endHour = parseInt(timeEnd.split(':')[0]);
    if (endHour <= startHour) throw new BadRequestException('Gio ket thuc phai sau gio bat dau');
    if (endHour - startHour > 4) throw new BadRequestException('Toi da chi duoc dat 4 gio lien tiep');
    return Array.from({ length: endHour - startHour }, (_, i) => `${String(startHour + i).padStart(2, '0')}:00`);
  }

  private generateFixedDates(dto: FixedSchedulePreviewDto) {
    const start = this.normalizeDate(dto.startDate);
    const end = this.normalizeDate(dto.endDate);
    if (end < start) throw new BadRequestException('Ngay ket thuc phai sau ngay bat dau');

    const dates: Date[] = [];
    const current = new Date(start);
    while (current <= end) {
      dates.push(new Date(current));
      if (dto.cycle === 'weekly') {
        current.setDate(current.getDate() + 7);
      } else {
        const day = current.getDate();
        current.setMonth(current.getMonth() + 1);
        if (current.getDate() !== day) current.setDate(0);
      }
    }
    return dates;
  }

  private async checkSlotConflict(client: any, courtId: number, date: Date, slots: string[]) {
    return client.courtSlot.findMany({
      where: {
        courtId,
        slotDate: date,
        time: { in: slots },
        status: { in: ['booked', 'hold'] },
      },
      select: { id: true, time: true, status: true, bookedBy: true, bookingId: true },
    });
  }

  private invoiceCode(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
  }

  async create(dto: CreateBookingDto) {
    const hours = this.buildHourSlots(dto.timeStart, dto.timeEnd);
    const dateObj = this.normalizeDate(dto.bookingDate);

    return this.prisma.$transaction(async (tx) => {
      const court = await tx.court.findUnique({
        where: { id: dto.courtId },
        select: { id: true, price: true, branchId: true, available: true, name: true },
      });
      if (!court) throw new NotFoundException('San khong ton tai');
      if (!court.available) throw new BadRequestException('San hien dang dong cua');

      const conflictSlots = await this.checkSlotConflict(tx, dto.courtId, dateObj, hours);
      if (conflictSlots.length > 0) {
        throw new ConflictException(`San da duoc dat vao luc: ${conflictSlots.map((s) => s.time).join(', ')}`);
      }

      const amount = Number(court.price) * hours.length;
      const booking = await tx.booking.create({
        data: {
          courtId: dto.courtId,
          branchId: court.branchId,
          bookingDate: dateObj,
          dayLabel: this.dayLabel(dateObj),
          timeStart: dto.timeStart,
          timeEnd: dto.timeEnd,
          amount,
          pricePerHour: court.price,
          people: dto.people || 2,
          paymentMethod: dto.paymentMethod,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail || null,
          userId: dto.userId || null,
          status: 'pending',
        },
      });

      await tx.courtSlot.createMany({
        data: hours.map((time) => ({
          courtId: dto.courtId,
          slotDate: dateObj,
          dateLabel: this.dayLabel(dateObj),
          time,
          status: 'hold',
          bookedBy: dto.customerName,
          phone: dto.customerPhone,
          bookingId: booking.id,
        })),
      });

      await tx.invoice.create({
        data: {
          code: this.invoiceCode('BK'),
          bookingId: booking.id,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail || null,
          subtotalSnapshot: amount,
          totalSnapshot: amount,
          paymentMethod: dto.paymentMethod,
          status: dto.paymentMethod === 'cash' ? 'unpaid' : 'paid',
          items: {
            create: [{
              description: `Dat san ${court.name} ${this.formatDate(dateObj)} ${dto.timeStart}-${dto.timeEnd}`,
              quantity: hours.length,
              unitPriceSnapshot: court.price,
              lineTotalSnapshot: amount,
            }],
          },
        },
      });

      return { ...booking, slots: hours, amount, court: { name: court.name } };
    });
  }

  async previewFixedSchedule(dto: FixedSchedulePreviewDto) {
    const hours = this.buildHourSlots(dto.timeStart, dto.timeEnd);
    const dates = this.generateFixedDates(dto);
    if (dates.length === 0) throw new BadRequestException('Khong co buoi nao trong khoang ngay da chon');

    const court = await this.prisma.court.findUnique({
      where: { id: dto.courtId },
      select: { id: true, name: true, price: true, available: true, branchId: true },
    });
    if (!court) throw new NotFoundException('San khong ton tai');
    if (!court.available) throw new BadRequestException('San hien dang dong cua');

    const occurrences = await Promise.all(dates.map(async (date) => {
      const conflicts = await this.checkSlotConflict(this.prisma, dto.courtId, date, hours);
      return {
        date: this.formatDate(date),
        dayLabel: this.dayLabel(date),
        courtId: dto.courtId,
        courtName: court.name,
        timeStart: dto.timeStart,
        timeEnd: dto.timeEnd,
        slots: hours,
        available: conflicts.length === 0,
        conflicts,
        pricePerHour: Number(court.price),
        amount: Number(court.price) * hours.length,
        skip: false,
      };
    }));

    const availableOccurrences = occurrences.filter((o) => o.available);
    return {
      court,
      cycle: dto.cycle,
      startDate: this.formatDate(this.normalizeDate(dto.startDate)),
      endDate: this.formatDate(this.normalizeDate(dto.endDate)),
      occurrences,
      totalOccurrences: occurrences.length,
      availableOccurrences: availableOccurrences.length,
      conflictOccurrences: occurrences.length - availableOccurrences.length,
      totalAmount: availableOccurrences.reduce((sum, o) => sum + o.amount, 0),
    };
  }

  async confirmFixedSchedule(dto: FixedScheduleConfirmDto) {
    const selected = (dto.occurrences || []).filter((o) => !o.skip);
    if (!selected.length) throw new BadRequestException('Can chon it nhat 1 buoi hop le');

    return this.prisma.$transaction(async (tx) => {
      const baseCourt = await tx.court.findUnique({
        where: { id: dto.courtId },
        select: { id: true, name: true, price: true, branchId: true, available: true },
      });
      if (!baseCourt) throw new NotFoundException('San khong ton tai');

      const checked: any[] = [];
      let totalAmount = 0;
      for (const item of selected) {
        const date = this.normalizeDate(item.date);
        const hours = this.buildHourSlots(item.timeStart, item.timeEnd);
        const court = await tx.court.findUnique({
          where: { id: item.courtId },
          select: { id: true, name: true, price: true, branchId: true, available: true },
        });
        if (!court || !court.available) throw new BadRequestException(`San #${item.courtId} khong kha dung`);
        const conflicts = await this.checkSlotConflict(tx, item.courtId, date, hours);
        if (conflicts.length > 0) {
          throw new ConflictException(`Ngay ${item.date} van con trung slot: ${conflicts.map((c) => c.time).join(', ')}`);
        }
        const amount = Number(court.price) * hours.length;
        totalAmount += amount;
        checked.push({ ...item, date, hours, court, amount });
      }

      const schedule = await tx.fixedSchedule.create({
        data: {
          userId: dto.userId || null,
          courtId: dto.courtId,
          cycle: dto.cycle,
          startDate: this.normalizeDate(dto.startDate),
          endDate: this.normalizeDate(dto.endDate),
          timeStart: dto.timeStart,
          timeEnd: dto.timeEnd,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail || null,
          paymentMethod: dto.paymentMethod,
          pricePerHourSnapshot: baseCourt.price,
          totalAmountSnapshot: totalAmount,
          occurrenceCount: checked.length,
          adjustmentLimit: dto.adjustmentLimit ?? 2,
          status: dto.paymentMethod === 'cash' ? 'pending' : 'confirmed',
        },
      });

      const bookings: any[] = [];
      for (const item of checked) {
        const occurrence = await tx.fixedScheduleOccurrence.create({
          data: {
            fixedScheduleId: schedule.id,
            courtId: item.court.id,
            occurrenceDate: item.date,
            timeStart: item.timeStart,
            timeEnd: item.timeEnd,
            pricePerHourSnapshot: item.court.price,
            amountSnapshot: item.amount,
            status: 'scheduled',
          },
        });
        const booking = await tx.booking.create({
          data: {
            courtId: item.court.id,
            branchId: item.court.branchId,
            bookingDate: item.date,
            dayLabel: this.dayLabel(item.date),
            timeStart: item.timeStart,
            timeEnd: item.timeEnd,
            amount: item.amount,
            pricePerHour: item.court.price,
            people: 2,
            paymentMethod: dto.paymentMethod,
            customerName: dto.customerName,
            customerPhone: dto.customerPhone,
            customerEmail: dto.customerEmail || null,
            userId: dto.userId || null,
            status: dto.paymentMethod === 'cash' ? 'pending' : 'confirmed',
            fixedScheduleId: schedule.id,
            fixedOccurrenceId: occurrence.id,
          },
        });
        await tx.courtSlot.createMany({
          data: item.hours.map((time) => ({
            courtId: item.court.id,
            slotDate: item.date,
            dateLabel: this.dayLabel(item.date),
            time,
            status: dto.paymentMethod === 'cash' ? 'hold' : 'booked',
            bookedBy: dto.customerName,
            phone: dto.customerPhone,
            bookingId: booking.id,
          })),
        });
        bookings.push(booking);
      }

      const invoice = await tx.invoice.create({
        data: {
          code: this.invoiceCode('FIX'),
          fixedScheduleId: schedule.id,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          customerEmail: dto.customerEmail || null,
          subtotalSnapshot: totalAmount,
          totalSnapshot: totalAmount,
          paymentMethod: dto.paymentMethod,
          status: dto.paymentMethod === 'cash' ? 'unpaid' : 'paid',
          items: {
            create: checked.map((item) => ({
              description: `Lich co dinh ${item.court.name} ${this.formatDate(item.date)} ${item.timeStart}-${item.timeEnd}`,
              quantity: item.hours.length,
              unitPriceSnapshot: item.court.price,
              lineTotalSnapshot: item.amount,
            })),
          },
        },
      });

      return { success: true, fixedSchedule: schedule, invoice, bookings };
    });
  }

  async confirm(id: string) {
    const booking = await this.findOne(id);
    if (booking.status !== 'pending' && booking.status !== 'deposited') {
      throw new BadRequestException(`Khong the xac nhan booking dang o trang thai ${booking.status}`);
    }
    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'confirmed',
        slots: { updateMany: { where: {}, data: { status: 'booked' } } },
      },
      include: { court: { include: { branch: true } }, user: true },
    });

    const email = updated.customerEmail || updated.user?.email;
    if (email) {
      await this.emailService.sendBookingConfirmed({
        id: updated.id,
        customerName: updated.customerName || updated.user?.fullName || 'Quy khach',
        customerEmail: email,
        courtName: updated.court.name,
        branchName: updated.court.branch?.name ?? '',
        bookingDate: updated.bookingDate.toISOString(),
        timeStart: updated.timeStart ?? '',
        timeEnd: updated.timeEnd ?? '',
        amount: parseFloat(String(updated.amount)),
      });
    }

    return { success: true, booking: updated };
  }

  async startPlaying(id: string) {
    const booking = await this.findOne(id);
    if (booking.status !== 'confirmed') throw new BadRequestException(`Khong the check-in booking ${booking.status}`);
    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: 'playing' },
      include: { court: { include: { branch: true } }, user: true },
    });
    return { success: true, booking: updated };
  }

  async complete(id: string) {
    const booking = await this.findOne(id);
    if (booking.status !== 'playing') throw new BadRequestException(`Khong the hoan thanh booking ${booking.status}`);
    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: 'completed' },
      include: { court: { include: { branch: true } }, user: true },
    });
    return { success: true, booking: updated };
  }

  async cancel(id: string) {
    const booking = await this.findOne(id);
    if (['completed', 'cancelled'].includes(booking.status)) throw new BadRequestException('Khong the huy booking nay');

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'cancelled',
        slots: { deleteMany: {} },
        ...(booking.fixedOccurrenceId ? { fixedOccurrence: { update: { status: 'cancelled' } } } : {}),
      },
      include: { court: { include: { branch: true } }, user: true },
    });
    return { success: true, booking: updated };
  }

  async updateStatus(id: string, dto: UpdateBookingStatusDto) {
    const booking = await this.findOne(id);
    const validTransitions: Record<string, string[]> = {
      pending: ['deposited', 'confirmed', 'cancelled'],
      deposited: ['confirmed', 'cancelled'],
      confirmed: ['playing', 'cancelled'],
      playing: ['completed'],
      completed: [],
      cancelled: [],
    };
    if (!validTransitions[booking.status]?.includes(dto.status)) {
      throw new BadRequestException(`Khong the chuyen tu ${booking.status} sang ${dto.status}`);
    }
    switch (dto.status) {
      case 'deposited':
        return {
          success: true,
          booking: await this.prisma.booking.update({ where: { id }, data: { status: 'deposited' } }),
        };
      case 'confirmed': return this.confirm(id);
      case 'playing': return this.startPlaying(id);
      case 'completed': return this.complete(id);
      case 'cancelled': return this.cancel(id);
    }
  }

  async findAll(filters: { branchId?: number; courtId?: number; date?: string; status?: string; phone?: string }) {
    return this.prisma.booking.findMany({
      where: {
        ...(filters.branchId && { branchId: filters.branchId }),
        ...(filters.courtId && { courtId: filters.courtId }),
        ...(filters.date && { bookingDate: this.normalizeDate(filters.date) }),
        ...(filters.status && { status: filters.status as any }),
        ...(filters.phone && { customerPhone: { contains: filters.phone } }),
      },
      include: {
        court: { select: { name: true, type: true } },
        branch: { select: { name: true } },
        user: { select: { fullName: true, phone: true } },
      },
      orderBy: [{ bookingDate: 'desc' }, { timeStart: 'asc' }],
    });
  }

  async findByUser(userId: string) {
    return this.prisma.booking.findMany({
      where: { userId },
      include: {
        court: { select: { name: true, image: true, type: true, price: true } },
        branch: { select: { name: true, address: true } },
        slots: { select: { time: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        court: { include: { amenities: true } },
        branch: true,
        user: { select: { fullName: true, email: true, phone: true } },
        slots: { orderBy: { time: 'asc' } },
        invoices: { include: { items: true } },
      },
    });
    if (!booking) throw new NotFoundException(`Booking #${id} khong ton tai`);
    return booking;
  }

  async findOneForUser(id: string, user: any) {
    const booking = await this.findOne(id);
    if (user.role === 'admin' || user.role === 'employee') return booking;
    if (booking.userId && booking.userId === user.id) return booking;
    throw new ForbiddenException('Ban khong co quyen xem booking nay');
  }

  async cancelForUser(id: string, user: any) {
    const booking = await this.findOne(id);
    if (!(user.role === 'admin' || user.role === 'employee' || (booking.userId && booking.userId === user.id))) {
      throw new ForbiddenException('Ban khong co quyen huy booking nay');
    }
    return this.cancel(id);
  }

  async getTodayBookings(branchId?: number) {
    const today = this.normalizeDate(new Date());
    return this.prisma.booking.findMany({
      where: {
        bookingDate: today,
        status: { in: ['confirmed', 'playing'] },
        ...(branchId && { branchId }),
      },
      include: {
        court: { select: { name: true, type: true } },
        branch: { select: { name: true } },
      },
      orderBy: { timeStart: 'asc' },
    });
  }

  async checkin(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { court: { include: { branch: true } }, user: true },
    });
    if (!booking) throw new NotFoundException('Khong tim thay booking');
    if (booking.status === 'playing') throw new BadRequestException('Khach da check-in roi');
    if (booking.status === 'completed') throw new BadRequestException('Booking da hoan thanh');
    if (booking.status === 'cancelled') throw new BadRequestException('Booking da bi huy');
    if (booking.status === 'pending' || booking.status === 'deposited') throw new BadRequestException('Booking chua duoc xac nhan thanh toan');

    const today = this.formatDate(new Date());
    const bookingDate = this.formatDate(booking.bookingDate);
    const now = new Date();
    const nowTotal = now.getHours() * 60 + now.getMinutes();
    const startTotal = parseInt(booking.timeStart.split(':')[0]) * 60 + parseInt(booking.timeStart.split(':')[1]);

    if (bookingDate !== today) throw new BadRequestException(`Booking nay danh cho ngay ${bookingDate}, hom nay la ${today}`);
    if (nowTotal < startTotal - 30) throw new BadRequestException(`Chua den gio check-in. Gio choi: ${booking.timeStart}`);

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'playing', updatedAt: new Date() },
      include: { court: { include: { branch: true } }, user: true },
    });

    return {
      success: true,
      message: 'Check-in thanh cong',
      booking: {
        id: updated.id,
        customerName: updated.customerName || updated.user?.fullName,
        customerPhone: updated.customerPhone,
        courtName: updated.court.name,
        branchName: updated.court.branch.name,
        bookingDate: updated.bookingDate,
        timeStart: updated.timeStart,
        timeEnd: updated.timeEnd,
        amount: updated.amount,
        status: updated.status,
      },
    };
  }

  async adjustFixedOccurrence(scheduleId: string, occurrenceId: string, dto: FixedScheduleAdjustDto, user: any) {
    return this.prisma.$transaction(async (tx) => {
      const schedule = await tx.fixedSchedule.findUnique({
        where: { id: scheduleId },
        include: { occurrences: true },
      });
      if (!schedule) throw new NotFoundException('Khong tim thay goi dat co dinh');
      if (!(user.role === 'admin' || user.role === 'employee' || (schedule.userId && schedule.userId === user.id))) {
        throw new ForbiddenException('Ban khong co quyen dieu chinh goi nay');
      }
      if (schedule.adjustmentUsed >= schedule.adjustmentLimit) {
        throw new BadRequestException('Da vuot qua so lan dieu chinh cho phep trong goi');
      }

      const occurrence = schedule.occurrences.find((o) => o.id === occurrenceId);
      if (!occurrence) throw new NotFoundException('Khong tim thay buoi trong goi');
      if (['cancelled', 'completed', 'skipped'].includes(occurrence.status)) {
        throw new BadRequestException('Buoi nay khong con co the dieu chinh');
      }

      const booking = await tx.booking.findUnique({
        where: { fixedOccurrenceId: occurrence.id },
        include: { slots: true },
      });
      if (!booking) throw new NotFoundException('Khong tim thay booking cua buoi nay');

      if (dto.type === 'skip') {
        await tx.courtSlot.deleteMany({ where: { bookingId: booking.id } });
        await tx.booking.update({ where: { id: booking.id }, data: { status: 'cancelled' } });
        await tx.fixedScheduleOccurrence.update({ where: { id: occurrence.id }, data: { status: 'skipped' } });
      } else {
        const newCourtId = dto.newCourtId ?? occurrence.courtId;
        const newDate = this.normalizeDate(dto.newDate || occurrence.occurrenceDate);
        const newTimeStart = dto.newTimeStart || occurrence.timeStart;
        const newTimeEnd = dto.newTimeEnd || occurrence.timeEnd;
        const hours = this.buildHourSlots(newTimeStart, newTimeEnd);
        const newCourt = await tx.court.findUnique({
          where: { id: newCourtId },
          select: { id: true, branchId: true, price: true, name: true, available: true },
        });
        if (!newCourt || !newCourt.available) throw new BadRequestException('San moi khong kha dung');

        const conflicts = await this.checkSlotConflict(tx, newCourtId, newDate, hours);
        const conflictsExcludingCurrent = conflicts.filter((slot) =>
          !booking.slots.some((current) =>
            current.courtId === newCourtId &&
            this.formatDate(current.slotDate) === this.formatDate(newDate) &&
            current.time === slot.time
          )
        );
        if (conflictsExcludingCurrent.length > 0) {
          throw new ConflictException(`Khung gio moi bi trung: ${conflictsExcludingCurrent.map((c) => c.time).join(', ')}`);
        }

        const amount = Number(newCourt.price) * hours.length;
        await tx.courtSlot.deleteMany({ where: { bookingId: booking.id } });
        await tx.fixedScheduleOccurrence.update({
          where: { id: occurrence.id },
          data: {
            courtId: newCourtId,
            occurrenceDate: newDate,
            timeStart: newTimeStart,
            timeEnd: newTimeEnd,
            pricePerHourSnapshot: newCourt.price,
            amountSnapshot: amount,
            status: 'rescheduled',
          },
        });
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            courtId: newCourtId,
            branchId: newCourt.branchId,
            bookingDate: newDate,
            dayLabel: this.dayLabel(newDate),
            timeStart: newTimeStart,
            timeEnd: newTimeEnd,
            pricePerHour: newCourt.price,
            amount,
          },
        });
        await tx.courtSlot.createMany({
          data: hours.map((time) => ({
            courtId: newCourtId,
            slotDate: newDate,
            dateLabel: this.dayLabel(newDate),
            time,
            status: booking.status === 'confirmed' ? 'booked' : 'hold',
            bookedBy: booking.customerName,
            phone: booking.customerPhone,
            bookingId: booking.id,
          })),
        });
      }

      await tx.fixedScheduleAdjustment.create({
        data: {
          fixedScheduleId: schedule.id,
          occurrenceId: occurrence.id,
          type: dto.type,
          oldCourtId: occurrence.courtId,
          oldDate: occurrence.occurrenceDate,
          oldTimeStart: occurrence.timeStart,
          oldTimeEnd: occurrence.timeEnd,
          newCourtId: dto.newCourtId || null,
          newDate: dto.newDate ? this.normalizeDate(dto.newDate) : null,
          newTimeStart: dto.newTimeStart || null,
          newTimeEnd: dto.newTimeEnd || null,
          note: dto.note || null,
        },
      });

      const updatedSchedule = await tx.fixedSchedule.update({
        where: { id: schedule.id },
        data: { adjustmentUsed: { increment: 1 } },
        include: { occurrences: true, adjustments: true },
      });
      return { success: true, fixedSchedule: updatedSchedule };
    });
  }
}
