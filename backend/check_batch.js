const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const batch = await p.productionBatch.findFirst({ where: { batchNumber: 'CEREZA-260413-1339' } });
  if (!batch) return process.exit(0);
  const notes = await p.assemblyNote.findMany({ where: { productionBatchId: batch.id }, include: { processType: true } });
  
  notes.forEach(n => {
    console.log(n.id, n.processType?.code, n.stageName);
  });
  
  process.exit(0);
})();
