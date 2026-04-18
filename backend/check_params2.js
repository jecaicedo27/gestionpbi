const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const cn = await p.assemblyNote.findFirst({ 
    where: { 
      productionBatchId: 'ca656f50-f8fc-4c0a-9d62-171ef07ab237', 
      processType: { code: 'CONTEO' } 
    } 
  });
  console.log(JSON.stringify(cn.processParameters.carriots, null, 2));
  process.exit(0);
})();
