import { Test, TestingModule } from '@nestjs/testing'
import { BookingsController } from './bookings.controller'
import { BookingsService } from './bookings.service'
import { FixedScheduleService } from './fixed-schedule.service'

describe('BookingsController', () => {
  let controller: BookingsController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        { provide: BookingsService, useValue: { create: jest.fn(), findAll: jest.fn(), findOne: jest.fn(), updateStatus: jest.fn() } },
        { provide: FixedScheduleService, useValue: { createFixedSchedule: jest.fn(), getAll: jest.fn() } },
      ],
    }).compile()

    controller = module.get<BookingsController>(BookingsController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })
})
