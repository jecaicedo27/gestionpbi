const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const p = await prisma.product.findUnique({ where: { sku: 'PROCEGENIALITY01' } });
  const lots = await prisma.materialLot.findMany({
        where: {
            productId: p.id
        },
        select: { currentQuantity: true, status: true, zone: true }
    });
  console.log(lots);
  console.log('Total:', lots.reduce((acc, l) => acc + l.currentQuantity, 0));
}
run().finally(() => prisma.$disconnect());
