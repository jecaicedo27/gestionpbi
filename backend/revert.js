const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  const formulaItem = await prisma.formulaItem.findFirst({
    where: { formula: { formulaCode: 'FORM010' }, ingredient: { name: 'PREMEZCLA CONSERVANTES PERLAS' } }
  });
  if (formulaItem) await prisma.formulaItem.update({ where: { id: formulaItem.id }, data: { quantity: 1 } });

  const noteItem = await prisma.assemblyNoteItem.findFirst({
    where: { assemblyNoteId: 'c0120534-1e6d-46ec-b332-a9672f4db508', component: { name: 'PREMEZCLA CONSERVANTES PERLAS' } }
  });
  if (noteItem) await prisma.assemblyNoteItem.update({ where: { id: noteItem.id }, data: { plannedQuantity: 1 } });
}

fix().catch(console.error).finally(() => prisma.$disconnect());
