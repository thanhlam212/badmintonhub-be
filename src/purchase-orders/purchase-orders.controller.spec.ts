import { Test, TestingModule } from '@nestjs/testing'
import { PurchaseOrdersController } from './purchase-orders.controller'
import { PurchaseOrdersService } from './purchase-orders.service'

describe('PurchaseOrdersController', () => {
  let controller: PurchaseOrdersController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseOrdersController],
      providers: [{ provide: PurchaseOrdersService, useValue: { getAll: jest.fn(), create: jest.fn(), updateStatus: jest.fn() } }],
    }).compile()

    controller = module.get<PurchaseOrdersController>(PurchaseOrdersController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })
})
