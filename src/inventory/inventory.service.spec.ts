import { Test, TestingModule } from '@nestjs/testing'
import { InventoryService } from './inventory.service'
import { PrismaService } from '../prisma/prisma.service'

describe('InventoryService', () => {
  let service: InventoryService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: { inventory: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() }, inventoryTransaction: { findMany: jest.fn(), create: jest.fn() }, $queryRaw: jest.fn(), $transaction: jest.fn() } },
      ],
    }).compile()

    service = module.get<InventoryService>(InventoryService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
