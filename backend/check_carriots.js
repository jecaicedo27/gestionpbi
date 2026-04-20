const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
   const conteo = await p.assemblyNote.findFirst({
        where: { productionBatchId: '04cff44e-1b84-48f8-b391-7f99be4eb2e5', processType: { code: 'CONTEO' } }
   });
   console.log("CARRIOTS", conteo.processParameters?.carriots);
   process.exit(0);
})();
