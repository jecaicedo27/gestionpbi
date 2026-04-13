const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function check() {
  const p = await prisma.product.findFirst({
    where: { name: 'PREMEZCLA CONSERVANTES PERLAS' },
    select: { currentStock: true, packSize: true, name: true, sku:true }
  });
  console.log(p);
}
check().finally(() => prisma.$disconnect());
