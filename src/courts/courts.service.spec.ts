import { Test, TestingModule } from '@nestjs/testing'
import { CourtsService } from './courts.service'
import { PrismaService } from '../prisma/prisma.service'

describe('CourtsService', () => {
  let service: CourtsService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CourtsService,
        { provide: PrismaService, useValue: { court: { findMany: jest.fn(), findUnique: jest.fn() } } },
      ],
    }).compile()

    service = module.get<CourtsService>(CourtsService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
