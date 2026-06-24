import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const bookings = await prisma.booking.findMany({
      include: {
        invoices: {
          include: {
            payments: true
          }
        }
      }
    });
    const filtered = bookings.filter(b => b.id.startsWith('4c60b651'));
    console.log("=== BOOKINGS FOUND ===");
    console.log(JSON.stringify(filtered, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
