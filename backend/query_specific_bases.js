const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sugar = await prisma.product.findFirst({ where: { name: { contains: 'AZUCAR', mode: 'insensitive' } } });
  
  // Products to check
  const keywords = ['BASE', 'AZUCAR INVERTI', 'PROTECCION', 'GOMAS PARA PERLAS', 'LIQUIPOPS'];
  
  const relevantProducts = await prisma.product.findMany({
      where: { OR: keywords.map(kw => ({ name: { contains: kw, mode: 'insensitive' } })) }
  });
  
  const productIds = relevantProducts.map(p => p.id);
  
  // 1. RPAs failed/pending for these
  const badExecutions = await prisma.rpaExecution.findMany({
    where: { 
        executionType: 'SIIGO_ASSEMBLY', 
        status: { notIn: ['COMPLETED', 'SUCCESS'] },
        productName: { in: relevantProducts.map(p => p.name).concat(relevantProducts.map(p => p.sku)) }
    },
    include: { assemblyNote: true }
  });
  
  // 2. Assembly notes grouped by batch that skipped RPA entirely
  const skippedNotes = await prisma.assemblyNote.findMany({
      where: {
          productId: { in: productIds },
          status: 'COMPLETED',
          processType: { code: { in: ['ENSAMBLE', 'FORMACION'] } },
          rpaExecutions: { none: {} }
      },
      include: { product: true, items: true, productionBatch: true }
  });

  console.log(`--- REPORTE DE DESCUADRES POR BASES ---`);
  
  let sugarInBadRpas = 0;
  for (const exec of badExecutions) {
      if (!exec.assemblyNoteId) continue;
      // Get all PESAJE notes for this batch
      const batchItems = await prisma.assemblyNoteItem.findMany({
          where: { 
              assemblyNote: { productionBatchId: exec.assemblyNote.productionBatchId },
              componentId: sugar.id
          }
      });
      const sugarUsed = batchItems.reduce((acc, item) => acc + (item.actualQuantity || 0), 0);
      sugarInBadRpas += sugarUsed;
      console.log(`[RPA FALLIDO] Batch: ${exec.assemblyNote.batchCode || exec.observations} | Producto: ${exec.productName} | Azúcar Física Usada: ${sugarUsed.toFixed(0)}g`);
  }
  
  let sugarInSkippedNotes = 0;
  for (const note of skippedNotes) {
      // Get all PESAJE notes for this batch
      const batchItems = await prisma.assemblyNoteItem.findMany({
          where: { 
              assemblyNote: { productionBatchId: note.productionBatchId },
              componentId: sugar.id
          }
      });
      const sugarUsed = batchItems.reduce((acc, item) => acc + (item.actualQuantity || 0), 0);
      
      // Look also at standard items if it consumes inside the note
      let innerSugar = 0;
      for (const it of note.items) {
          if (it.componentId === sugar.id) innerSugar += it.actualQuantity || 0;
      }
      
      const realSugar = Math.max(sugarUsed, innerSugar);
      sugarInSkippedNotes += realSugar;
      
      console.log(`[RPA NUNCA ENVIADO] Batch: ${note.productionBatch?.batchNumber || note.noteNumber} | Producto: ${note.product.name} | Azúcar Física Usada: ${realSugar.toFixed(0)}g`);
  }

  console.log(`\nRESUMEN DE AZUCAR FISICAMENTE ATRAPADA EN BASES:`);
  console.log(`En RPAs Fallidos: ${sugarInBadRpas.toFixed(0)} g`);
  console.log(`En Notas Saltadas (Sin RPA): ${sugarInSkippedNotes.toFixed(0)} g`);
  console.log(`TOTAL: ${(sugarInBadRpas + sugarInSkippedNotes).toFixed(0)} g`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
