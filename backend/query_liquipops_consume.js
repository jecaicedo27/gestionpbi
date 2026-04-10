const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const item = await prisma.product.findFirst({ where: { name: 'TARRO LIQUIPOPS 1150 GR - 1000ML' }});
  
  if (!item) {
     console.log("No tarro found"); return;
  }
  
  const notes = await prisma.assemblyNoteItem.findMany({
    where: { componentId: item.id },
    include: { assemblyNote: { select: { noteNumber: true, status: true, processType: { select: { code: true } }, completedAt: true, processParameters: true } } },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  console.log(JSON.stringify(notes.map(n => ({
      note: n.assemblyNote.noteNumber, 
      type: n.assemblyNote.processType?.code,
      status: n.assemblyNote.status,
      plannedQty: n.plannedQuantity,
      actualQty: n.actualQuantity,
      consumed: n.consumed, 
      completedAt: n.assemblyNote.completedAt,
      processParams: n.assemblyNote.processParameters
  })), null, 2));

}

main().catch(console.error).finally(() => prisma.$disconnect());
