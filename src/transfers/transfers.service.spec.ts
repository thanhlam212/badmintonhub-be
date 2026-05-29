import { Test, TestingModule } from '@nestjs/testing'
import { TransfersService } from './transfers.service'
import { PrismaService } from '../prisma/prisma.service'

describe('TransfersService', () => {
  let service: TransfersService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransfersService,
        { provide: PrismaService, useValue: { transferRequest: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() }, warehouse: { findUnique: jest.fn() }, inventory: { findUnique: jest.fn() } } },
      ],
    }).compile()

    service = module.get<TransfersService>(TransfersService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
