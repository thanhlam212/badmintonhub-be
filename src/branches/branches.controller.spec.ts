import { Test, TestingModule } from '@nestjs/testing'
import { BranchesController } from './branches.controller'
import { BranchesService } from './branches.service'

describe('BranchesController', () => {
  let controller: BranchesController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BranchesController],
      providers: [{ provide: BranchesService, useValue: { findAll: jest.fn(), findOne: jest.fn() } }],
    }).compile()

    controller = module.get<BranchesController>(BranchesController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })
})
