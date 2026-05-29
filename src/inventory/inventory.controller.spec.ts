import { Test, TestingModule } from '@nestjs/testing'
import { InventoryController } from './inventory.controller'
import { InventoryService } from './inventory.service'

describe('InventoryController', () => {
  let controller: InventoryController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [{ provide: InventoryService, useValue: { getAll: jest.fn(), getLowStock: jest.fn(), getTransactions: jest.fn(), importStock: jest.fn(), exportStock: jest.fn() } }],
    }).compile()

    controller = module.get<InventoryController>(InventoryController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })
})
