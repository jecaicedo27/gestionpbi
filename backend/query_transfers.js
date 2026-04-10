const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const item = await prisma.product.findFirst({ where: { name: 'TARRO LIQUIPOPS 1150 GR - 1000ML' }});
  
  if (!item) {
     console.log("No tarro found"); return;
  }
  
  const logs = await prisma.auditLog.findMany({
    where: { 
        entityId: item.id,
        entity: 'Product' 
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  console.log("Transfers for Tarro 1150:");
  console.log(JSON.stringify(logs, null, 2));

  const noteLogs = await prisma.auditLog.findMany({
      where: { action: 'CONSUMPTION_ALERT' },
      orderBy: { createdAt: 'desc' },
      take: 5
  });
  console.log("Consumption Alerts:");
  console.log(JSON.stringify(noteLogs, null, 2));

}

main().catch(console.error).finally(() => prisma.$disconnect());
