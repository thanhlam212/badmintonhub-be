import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const waterProducts = [
  {
    sku: 'NUOC-AQUA-500',
    name: 'Nuoc suoi Aquafina 500ml',
    brand: 'Aquafina',
    category: 'Nuoc uong',
    price: 10000,
    unitCost: 6000,
    onHand: 48,
    reorderPoint: 12,
    image: 'https://images.unsplash.com/photo-1523362628745-0c100150b504?w=800&q=80',
  },
  {
    sku: 'NUOC-LAVIE-500',
    name: 'Nuoc suoi Lavie 500ml',
    brand: 'Lavie',
    category: 'Nuoc uong',
    price: 10000,
    unitCost: 6000,
    onHand: 48,
    reorderPoint: 12,
    image: 'https://images.unsplash.com/photo-1560847468-5eef330f455a?w=800&q=80',
  },
  {
    sku: 'NUOC-REVIVE-500',
    name: 'Revive 500ml',
    brand: 'Revive',
    category: 'Nuoc uong',
    price: 15000,
    unitCost: 9000,
    onHand: 36,
    reorderPoint: 10,
    image: 'https://images.unsplash.com/photo-1544145945-f90425340c7e?w=800&q=80',
  },
  {
    sku: 'NUOC-COCA-330',
    name: 'Coca-Cola lon 330ml',
    brand: 'Coca-Cola',
    category: 'Nuoc uong',
    price: 12000,
    unitCost: 8000,
    onHand: 36,
    reorderPoint: 10,
    image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=800&q=80',
  },
]

async function main() {
  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true },
    orderBy: { id: 'asc' },
  })

  if (warehouses.length === 0) {
    throw new Error('Khong co kho active de them nuoc.')
  }

  let createdInventoryRows = 0

  for (const item of waterProducts) {
    const product = await prisma.product.upsert({
      where: { sku: item.sku },
      update: {
        name: item.name,
        brand: item.brand,
        category: item.category,
        price: item.price,
        image: item.image,
        inStock: true,
      },
      create: {
        sku: item.sku,
        name: item.name,
        brand: item.brand,
        category: item.category,
        price: item.price,
        originalPrice: null,
        rating: 0,
        reviewsCount: 0,
        image: item.image,
        description: `${item.name} ban tai san cau long.`,
        specs: { dungTich: item.name.includes('330ml') ? '330ml' : '500ml' },
        features: ['Giai khat', 'Ban tai san', 'Tru kho khi thanh toan dich vu san'],
        inStock: true,
        gender: null,
      },
    })

    for (const warehouse of warehouses) {
      const existing = await prisma.inventory.findUnique({
        where: { sku_warehouseId: { sku: item.sku, warehouseId: warehouse.id } },
      })

      if (existing) {
        await prisma.inventory.update({
          where: { sku_warehouseId: { sku: item.sku, warehouseId: warehouse.id } },
          data: {
            productId: product.id,
            name: item.name,
            category: item.category,
            reorderPoint: item.reorderPoint,
            unitCost: item.unitCost,
            image: item.image,
          },
        })
        continue
      }

      await prisma.inventory.create({
        data: {
          sku: item.sku,
          productId: product.id,
          warehouseId: warehouse.id,
          name: item.name,
          category: item.category,
          onHand: item.onHand,
          reserved: 0,
          available: item.onHand,
          reorderPoint: item.reorderPoint,
          unitCost: item.unitCost,
          image: item.image,
        },
      })
      createdInventoryRows += 1
    }
  }

  console.log(`Water products: ${waterProducts.length}`)
  console.log(`Warehouses: ${warehouses.length}`)
  console.log(`New inventory rows: ${createdInventoryRows}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
