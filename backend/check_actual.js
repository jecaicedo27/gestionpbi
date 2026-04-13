const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function check() {
  const noteItem = await prisma.assemblyNoteItem.findFirst({
    where: { assemblyNoteId: 'c0120534-1e6d-46ec-b332-a9672f4db508', component: { name: 'PREMEZCLA CONSERVANTES PERLAS' } }
  });
  console.log('Actual Qty:', noteItem.actualQuantity, 'Planned Qty:', noteItem.plannedQuantity);
  
  if (noteItem.actualQuantity !== 1) {
    await prisma.assemblyNoteItem.update({
      where: { id: noteItem.id },
      data: { actualQuantity: 1, plannedQuantity: 1 }
    });
    console.log('Fixed actualQuantity and plannedQuantity to 1');
  }
}
check().finally(() => prisma.$disconnect());
