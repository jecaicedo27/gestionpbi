const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
   const empaque = await p.assemblyNote.findUnique({ where: { id: 'a1f583ea-fd02-4ac3-bf9e-86533028d53a' } });
   const batchId = empaque.productionBatchId;
   const conteos = await p.assemblyNote.findMany({
        where: { productionBatchId: batchId },
        include: { processType: true }
   });
   conteos.forEach(c => console.log(c.processType.code, c.stageName));
   process.exit(0);
})();
