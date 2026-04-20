const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const rpaExecs = await p.rpaExecution.findMany({
      where: { 
          executionType: 'SIIGO_ASSEMBLY',
          observations: { contains: 'CEREZA-260413-1339' }
      }
  });

  console.log(JSON.stringify(rpaExecs, null, 2));
  process.exit(0);
})();
