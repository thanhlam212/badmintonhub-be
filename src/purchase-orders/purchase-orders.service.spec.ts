import { Test, TestingModule } from '@nestjs/testing'
import { PurchaseOrdersService } from './purchase-orders.service'
import { PrismaService } from '../prisma/prisma.service'

describe('PurchaseOrdersService', () => {
  let service: PurchaseOrdersService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: { purchaseOrder: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() }, supplier: { findUnique: jest.fn() }, warehouse: { findUnique: jest.fn() } } },
      ],
    }).compile()

    service = module.get<PurchaseOrdersService>(PurchaseOrdersService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })
})
