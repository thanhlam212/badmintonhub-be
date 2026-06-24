import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log("=== CHECKING SALES ORDERS ===");
    const salesOrders = await prisma.salesOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        items: true,
        branch: true
      }
    });
    for (const so of salesOrders) {
      console.log(`SalesOrder: ${so.id}, branchId: ${so.branchId} (${so.branch?.name}), customerName: ${so.customerName}, total: ${so.total}, status: ${so.status}`);
      for (const item of so.items) {
        console.log(`  - Item: ${item.productName} (id: ${item.productId}), Qty: ${item.qty}, Price: ${item.price}`);
      }
    }

    console.log("\n=== CHECKING INVENTORY FOR THE PRODUCT ===");
    // Find product with name contains 'Yonex' or '10559EX'
    const products = await prisma.product.findMany({
      where: {
        name: { contains: "10559EX", mode: "insensitive" }
      }
    });
    console.log(`Found ${products.length} matching products:`);
    for (const p of products) {
      console.log(`Product ID: ${p.id}, Name: ${p.name}, SKU: ${p.sku}`);
      
      const invs = await prisma.inventory.findMany({
        where: { sku: p.sku },
        include: { warehouse: true }
      });
      for (const inv of invs) {
        console.log(`  - Warehouse ID: ${inv.warehouseId} (${inv.warehouse.name}), onHand: ${inv.onHand}, available: ${inv.available}`);
      }
    }

    console.log("\n=== CHECKING LATEST INVENTORY TRANSACTIONS ===");
    const txs = await prisma.inventoryTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { warehouse: true }
    });
    for (const tx of txs) {
      console.log(`Tx: ${tx.id}, type: ${tx.type}, date: ${tx.date}, sku: ${tx.sku}, warehouse: ${tx.warehouseId} (${tx.warehouse.name}), qty: ${tx.qty}, note: ${tx.note}`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
