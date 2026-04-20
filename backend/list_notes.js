const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const batch = await p.productionBatch.findFirst({ where: { batchNumber: 'CEREZA-260413-1339' } });
  const notes = await p.assemblyNote.findMany({ 
    where: { productionBatchId: batch.id },
    include: { processType: true, product: true }
  });

  for (const n of notes) {
      console.log(`[${n.processType?.code}] ${n.product?.name} (ID: ${n.id})`);
  }
  process.exit(0);
})();
