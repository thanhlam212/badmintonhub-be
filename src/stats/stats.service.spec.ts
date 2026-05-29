import { Test, TestingModule } from '@nestjs/testing'
import { StatsService } from './stats.service'
import { PrismaService } from '../prisma/prisma.service'

describe('StatsService', () => {
  let service: StatsService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatsService,
        { provide: PrismaService, useValue: { $queryRaw: jest.fn() } },
      ],
    }).compile()

    service = module.get<StatsService>(StatsService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
