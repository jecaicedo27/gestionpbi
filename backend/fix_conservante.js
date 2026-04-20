const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const conservanteId = '4ee989ee-9e91-4b4a-9b6d-f0c78770863f';

  const batches = await prisma.productionBatch.findMany({
    where: {
      status: { not: 'COMPLETED' },
      OR: [
        { batchNumber: { contains: 'BLUEBERRY', mode: 'insensitive' } },
        { batchNumber: { contains: 'CAFE', mode: 'insensitive' } },
      ]
    },
    select: { id: true, batchNumber: true, status: true, scheduledStart: true }
  });

  console.log('Non-completed BLUEBERRY/CAFE batches: ' + batches.length);
  batches.forEach(b => console.log('  ' + b.batchNumber + ' [' + b.status + '] start: ' + b.scheduledStart));

  let totalFixed = 0;
  for (const batch of batches) {
    const notes = await prisma.assemblyNote.findMany({
      where: {
        productionBatchId: batch.id,
        stageName: { contains: 'COMPUESTO' },
      },
      select: {
        id: true, stageName: true, status: true,
        processType: { select: { code: true } },
        items: { select: { componentId: true } }
      }
    });

    for (const note of notes) {
      const hasConservante = note.items.some(i => i.componentId === conservanteId);
      if (!hasConservante && note.items.length > 0) {
        await prisma.assemblyNoteItem.create({
          data: {
            assemblyNoteId: note.id,
            componentId: conservanteId,
            componentType: 'RAW_MATERIAL',
            plannedQuantity: 1,
            unit: 'unidad',
          }
        });
        console.log('  FIXED: ' + batch.batchNumber + ' / ' + note.stageName + ' (' + note.processType?.code + ')');
        totalFixed++;
      } else if (note.items.length > 0) {
        console.log('  OK:    ' + batch.batchNumber + ' / ' + note.stageName + ' (' + note.processType?.code + ')');
      }
    }
  }

  console.log('\nTotal fixed: ' + totalFixed);
  await prisma.$disconnect();
})();
