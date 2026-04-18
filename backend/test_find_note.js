const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const batch = await p.productionBatch.findFirst({ where: { batchNumber: 'CEREZA-260413-1339' } });
  const notesArray = await p.assemblyNote.findMany({ 
    where: { productionBatchId: batch.id },
    include: { processType: true, product: true }
  });

  const conteoNote = notesArray.find(n => n.processType.code === 'CONTEO');
  
  // Simulated parameters
  const productId = '0d052272-4c40-40ad-ba54-5fe430c64fb8'; // 1000 ML
  
  let n = notesArray.find(n => n.productId === productId && (n.processType?.code === 'EMPAQUE' || n.processType?.code === 'G_EMPAQUE'));
  console.log("Direct match:", n ? n.id : null);
  
  if (!n && conteoNote?.processParameters?.conteo) {
      const conteoParams = Object.values(conteoNote.processParameters.conteo);
      const conteoMatch = conteoParams.find(p => p.productId === productId);
      if (conteoMatch?.productName) {
          const sizeMatch = conteoMatch.productName.match(/X\s+\d+\s+(ML|LTS|GRS|KG)/i);
          if (sizeMatch) {
              const sizeStr = sizeMatch[0].toUpperCase();
              n = notesArray.find(x => x.processType?.code === 'G_EMPAQUE' && x.product?.name?.toUpperCase().includes(sizeStr));
          }
      }
  }

  console.log("Final match:", n ? n.id : null);

  process.exit(0);
})();
