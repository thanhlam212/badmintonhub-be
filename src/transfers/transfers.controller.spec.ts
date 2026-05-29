import { Test, TestingModule } from '@nestjs/testing'
import { TransfersController } from './transfers.controller'
import { TransfersService } from './transfers.service'

describe('TransfersController', () => {
  let controller: TransfersController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransfersController],
      providers: [{ provide: TransfersService, useValue: { getAll: jest.fn(), create: jest.fn(), updateStatus: jest.fn() } }],
    }).compile()

    controller = module.get<TransfersController>(TransfersController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })
})
