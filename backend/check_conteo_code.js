const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
   const conteo = await p.assemblyNote.findFirst({
        where: { productionBatchId: '04cff44e-1b84-48f8-b391-7f99be4eb2e5', processType: { code: { contains: 'CONTEO' } } },
        include: { processType: true }
   });
   console.log(conteo.processType.code);
   process.exit(0);
})();
