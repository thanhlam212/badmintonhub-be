import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const id = 'e9780651-4ff5-4729-a7b7-73a4cc453d0f';
  try {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        invoices: {
          include: {
            payments: true
          }
        }
      }
    });
    console.log("=== BOOKING DETAILS ===");
    console.log(JSON.stringify(booking, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
