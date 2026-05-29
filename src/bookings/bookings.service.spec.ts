import { Test, TestingModule } from '@nestjs/testing'
import { BookingsService } from './bookings.service'
import { PrismaService } from '../prisma/prisma.service'
import { EmailService } from '../email/email.service'
import { FixedScheduleService } from './fixed-schedule.service'

describe('BookingsService', () => {
  let service: BookingsService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: { booking: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() }, invoice: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() }, $transaction: jest.fn() } },
        { provide: EmailService, useValue: { sendBookingConfirmation: jest.fn() } },
        { provide: FixedScheduleService, useValue: { createFixedSchedule: jest.fn() } },
      ],
    }).compile()

    service = module.get<BookingsService>(BookingsService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
