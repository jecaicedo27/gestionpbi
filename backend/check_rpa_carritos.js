const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const rpaExecs = await p.rpaExecution.findMany({
      where: { 
          executionType: 'SIIGO_ASSEMBLY',
          observations: { contains: 'Carrito' }
      }
  });
  console.log(rpaExecs.length, 'total carrito executions');
  
  const cereza = rpaExecs.filter(r => r.observations.includes('CEREZA'));
  console.log(cereza.length, 'cereza carrito executions');
  if (cereza.length > 0) {
      console.log(nereza.map(r => r.quantity));
  }
  process.exit(0);
})();
