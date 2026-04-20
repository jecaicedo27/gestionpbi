const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const batch = await p.productionBatch.findFirst({ where: { batchNumber: 'CEREZA-260413-1339' } });
  if (!batch) return process.exit(0);
  const conteo = await p.assemblyNote.findFirst({ where: { productionBatchId: batch.id, processType: { code: 'CONTEO' } } });
  if (conteo && conteo.processParameters && conteo.processParameters.carriots) {
     let updated = false;
     const newCarriots = conteo.processParameters.carriots.map(c => {
         if (!c.labeledAt) { 
            updated = true;
            return { ...c, labeledAt: c.receivedAt || new Date().toISOString(), printed: true };
         }
         return c;
     });
     if (updated) {
         await p.assemblyNote.update({
             where: { id: conteo.id },
             data: { processParameters: { ...conteo.processParameters, carriots: newCarriots } }
         });
         console.log('Updated carriots with labeledAt dates');
     } else {
         console.log('No carriots to update');
     }
  }
  process.exit(0);
})();
