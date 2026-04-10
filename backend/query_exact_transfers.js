const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const item = await prisma.product.findFirst({ where: { name: 'TARRO LIQUIPOPS 1150 GR - 1000ML' }});
  
  const logs = await prisma.auditLog.findMany({
    where: { 
        entityId: item.id,
        entity: 'Product' 
    },
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  logs.forEach(l => {
      console.log(`[${l.createdAt.toISOString()}] Action: ${l.action}`);
      console.log(`Changes: ${JSON.stringify(l.changes)}`);
      console.log('---');
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
