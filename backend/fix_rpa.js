const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const batch = await p.productionBatch.findFirst({ where: { batchNumber: 'CEREZA-260413-1339' } });
  if (!batch) return process.exit(0);

  const conteo = await p.assemblyNote.findFirst({ where: { productionBatchId: batch.id, processType: { code: 'CONTEO' } } });
  if (!conteo || !conteo.processParameters || !conteo.processParameters.carriots) return process.exit(0);

  const rpaExecs = await p.rpaExecution.findMany({
      where: { 
          executionType: 'SIIGO_ASSEMBLY',
          observations: { contains: batch.batchNumber }
      },
      orderBy: { startedAt: 'asc' }
  });

  let updated = false;
  const newCarriots = conteo.processParameters.carriots.map(c => {
      if (!c.rpaExecutionId) {
          // Find the earliest rpa execution matching this qty that started within ~5 mins of receivedAt
          const rpa = rpaExecs.find(r => r.quantity === c.qty && Math.abs(r.startedAt.getTime() - new Date(c.receivedAt).getTime()) < 1000 * 60 * 15);
          if (rpa) {
              c.rpaExecutionId = rpa.id;
              updated = true;
          }
      }
      return c;
  });

  if (updated) {
      await p.assemblyNote.update({
          where: { id: conteo.id },
          data: { processParameters: { ...conteo.processParameters, carriots: newCarriots } }
      });
      console.log('Linked RPA execution IDs to carritos.');
  } else {
      console.log('No carritos needed linking.');
  }
  process.exit(0);
})();
