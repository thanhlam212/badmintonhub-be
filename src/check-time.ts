import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const dbTime: any = await prisma.$queryRaw`SELECT NOW() as now`;
    console.log("App Time (UTC):", new Date().toISOString());
    console.log("DB Time (UTC):", dbTime[0].now.toISOString());
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
