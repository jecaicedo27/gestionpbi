const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
   const empaque = await p.assemblyNote.findUnique({ where: { id: 'a1f583ea-fd02-4ac3-bf9e-86533028d53a' } });
   const batchId = empaque.productionBatchId;
   const conteo = await p.assemblyNote.findFirst({
        where: { productionBatchId: batchId, processType: { code: 'CONTEO' } }
   });
   console.log("CARRIOTS", JSON.stringify(conteo.processParameters?.carriots, null, 2));
   process.exit(0);
})();
