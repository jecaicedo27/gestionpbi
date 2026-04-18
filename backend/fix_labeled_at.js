const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const batch = await p.productionBatch.findFirst({ where: { batchNumber: 'CEREZA-260413-1339' } });
  const cn = await p.assemblyNote.findFirst({ 
    where: { 
      productionBatchId: batch.id, 
      processType: { code: 'CONTEO' } 
    } 
  });

  const changed = cn.processParameters.carriots.map(c => {
    if (c.carritoNum === 2 || c.carritoNum === 4) {
      // Keep receivedAt but wipe labeledAt
      return { ...c, labeledAt: null };
    }
    return c;
  });

  await p.assemblyNote.update({
    where: { id: cn.id },
    data: {
      processParameters: {
        ...cn.processParameters,
        carriots: changed
      }
    }
  });

  console.log("Wiped labeledAt for Carrito #2 and Carrito #4");
  process.exit(0);
})();
