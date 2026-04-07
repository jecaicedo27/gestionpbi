const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const t = await p.assemblyTemplate.findFirst({
    where: { templateCode: 'BATCH-GENIALITY' },
    include: {
      stages: {
        include: {
          processType: true,
          inputs: { include: { product: { select: { id: true, name: true } } } }
        },
        orderBy: { stageOrder: 'asc' }
      }
    }
  });
  if (!t) { console.log('BATCH-GENIALITY NOT FOUND'); return; }
  console.log(JSON.stringify({
    id: t.id, code: t.templateCode, name: t.templateName,
    totalStages: t.totalStages, isActive: t.isActive,
    stages: t.stages.map(s => ({
      order: s.stageOrder, name: s.stageName,
      processCode: s.processType.code, processName: s.processType.name,
      inputCount: s.inputs.length,
      inputs: s.inputs.map(i => ({ name: i.product?.name, qty: i.quantityPerUnit, unit: i.unit }))
    }))
  }, null, 2));

  // Also check what note was created for the latest batch
  const latestNote = await p.assemblyNote.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { processType: true, productionBatch: true }
  });
  if (latestNote) {
    console.log('\n--- LATEST NOTE ---');
    console.log(JSON.stringify({
      noteId: latestNote.id, noteNumber: latestNote.noteNumber,
      stageName: latestNote.stageName, stageOrder: latestNote.stageOrder,
      status: latestNote.status,
      processCode: latestNote.processType?.code,
      processName: latestNote.processType?.name,
      batchNumber: latestNote.productionBatch?.batchNumber,
      batchFlavor: latestNote.productionBatch?.flavor
    }, null, 2));
  }
  await p.$disconnect();
})();
