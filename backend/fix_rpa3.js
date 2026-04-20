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

  const conteo = await p.assemblyNote.findFirst({ 
      where: { 
          productionBatchId: 'ca656f50-f8fc-4c0a-9d62-171ef07ab237'
      } 
  });
  console.log(conteo);
  process.exit(0);
})();
