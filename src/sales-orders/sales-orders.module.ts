import { Module } from '@nestjs/common'
import { SalesOrdersController } from './sales-orders.controller'
import { SalesOrdersService } from './sales-orders.service'
import { PrismaModule } from '../prisma/prisma.module'
import { EmailModule } from '../email/email.module'

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [SalesOrdersController],
  providers: [SalesOrdersService],
  exports: [SalesOrdersService],
})
export class SalesOrdersModule {}
