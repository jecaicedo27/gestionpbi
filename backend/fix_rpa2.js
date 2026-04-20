const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const rpaExecs = await p.rpaExecution.findMany({
      where: { 
          executionType: 'SIIGO_ASSEMBLY',
          observations: { contains: 'Carrito' }
      },
      orderBy: { startedAt: 'asc' }
  });

  const allConteos = await p.assemblyNote.findMany({
      where: { processType: { code: 'CONTEO' } }
  });

  let counter = 0;
  for (const conteo of allConteos) {
      if (!conteo.processParameters || !conteo.processParameters.carriots) continue;

      let bNumberMatch = null;
      // Get batch number from db
      const batch = await p.productionBatch.findUnique({ where: { id: conteo.productionBatchId } });
      if (!batch) continue;
      bNumberMatch = batch.batchNumber;

      const newCarriots = conteo.processParameters.carriots.map(c => {
          if (!c.rpaExecutionId && bNumberMatch) {
              const rpa = rpaExecs.find(r => 
                 r.observations.includes(bNumberMatch) && 
                 r.quantity === c.qty
              );
              if (rpa) {
                  c.rpaExecutionId = rpa.id;
                  counter++;
                  // Remove it from arr so it's not reused
                  rpaExecs.splice(rpaExecs.findIndex(x => x.id === rpa.id), 1);
              }
          }
          return c;
      });

      if (counter > 0) {
          await p.assemblyNote.update({
              where: { id: conteo.id },
              data: { processParameters: { ...conteo.processParameters, carriots: newCarriots } }
          });
      }
  }

  console.log(`Linked ${counter} RPA execution IDs to carritos.`);
  process.exit(0);
})();
