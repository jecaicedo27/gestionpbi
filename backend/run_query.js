const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Starting script...");
  const item = await prisma.product.findFirst({ where: { name: 'TARRO LIQUIPOPS 1150 GR - 1000ML' }});
  
  if (!item) {
      console.log("No tarro found");
      return;
  }

  const notes = await prisma.assemblyNoteItem.findMany({
    where: { componentId: item.id },
    include: { assemblyNote: { select: { noteNumber: true, status: true, processType: { select: { code: true } }, completedAt: true, processParameters: true, productionBatch: { select: { batchNumber: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  console.log("Recent EMPAQUE Notes using Tarro 1150:");
  notes.forEach(n => {
      if(n.assemblyNote.processType?.code === 'EMPAQUE') {
         console.log(`- Lote: ${n.assemblyNote.productionBatch?.batchNumber}`);
         console.log(`  Note: ${n.assemblyNote.noteNumber} | Status: ${n.assemblyNote.status}`);
         console.log(`  Planned: ${n.plannedQuantity} | Actual: ${n.actualQuantity} | Consumed: ${n.consumed}`);
         console.log(`  Conteo_qty: ${n.assemblyNote.processParameters?.empaque?.conteo_qty}`);
      }
  });

  const logs = await prisma.auditLog.findMany({
      where: {
          entity: 'Product',
          entityId: item.id
      },
      orderBy: { createdAt: 'desc' },
      take: 10
  });
  console.log("\nRecent Product Audit Logs for Tarro 1150:");
  logs.forEach(l => console.log(l));
  
}

main().catch(console.error).finally(() => prisma.$disconnect());
