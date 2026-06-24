import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }

  async syncProductInStock(tx: any, sku: string) {
    const totalAvailable = await tx.inventory.aggregate({
      where: { sku },
      _sum: { available: true }
    });
    const sum = totalAvailable._sum.available ?? 0;
    await tx.product.updateMany({
      where: { sku },
      data: { inStock: sum > 0 }
    });
  }
}