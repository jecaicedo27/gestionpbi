const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sugar = await prisma.product.findFirst({ where: { name: { contains: 'AZUCAR', mode: 'insensitive' } } });
  
  const unexecutedNotes = await prisma.assemblyNote.findMany({
    where: { 
        status: 'COMPLETED',
        rpaExecutions: { none: {} }
    },
    include: {
        items: { where: { componentId: sugar.id, actualQuantity: { gt: 0 } } }
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  for (const n of unexecutedNotes) {
      if (n.items.length > 0) {
          const qty = n.items.reduce((sum, item) => sum + item.actualQuantity, 0);
          console.log(`Note ${n.noteNumber} (Date: ${n.createdAt.toISOString()}): uses ${qty}g of sugar`);
      }
  }

}

main().catch(console.error).finally(() => prisma.$disconnect());
