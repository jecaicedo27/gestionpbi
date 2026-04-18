const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const batch = await p.productionBatch.findFirst({ where: { batchNumber: 'CEREZA-260413-1339' } });
  const cn = await p.assemblyNote.findFirst({ 
    where: { 
      productionBatchId: batch.id, 
      processType: { code: 'CONTEO' } 
    } 
  });
  console.log(JSON.stringify(cn.processParameters.carriots, null, 2));
  process.exit(0);
})();
