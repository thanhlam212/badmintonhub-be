import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './auth/guards/roles.guard';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { BranchesModule } from './branches/branches.module';
import { CourtsModule } from './courts/courts.module';
import { BookingsModule } from './bookings/bookings.module';
import { EmailModule } from './email/email.module';
import { ProductsService } from './products/products.service';
import { ProductsModule } from './products/products.module';
import { OrderModule } from './order/order.module';
import { OrderController } from './order/order.controller';
import { StatsService } from './stats/stats.service';
import { StatsModule } from './stats/stats.module';
import { InventoryModule } from './inventory/inventory.module';
import { WarehouseService } from './warehouse/warehouse.service';
import { WarehouseController } from './warehouse/warehouse.controller';
import { WarehouseModule } from './warehouse/warehouse.module';
import { TransfersModule } from './transfers/transfers.module';
import { PurchaseOrdersController } from './purchase-orders/purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders/purchase-orders.service';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';


@Module({
  imports: [
            ConfigModule.forRoot({ isGlobal: true }),
            PrismaModule, 
            AuthModule, 
            BranchesModule, 
            CourtsModule, BookingsModule, EmailModule, ProductsModule, OrderModule, StatsModule, InventoryModule, WarehouseModule, TransfersModule, PurchaseOrdersModule,
            ],
   providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    ProductsService,
    StatsService,
    WarehouseService,
    PurchaseOrdersService,
  ],
   controllers: [OrderController, WarehouseController, PurchaseOrdersController],
})
export class AppModule {}
