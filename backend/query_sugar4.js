const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sugar = await prisma.product.findFirst({ where: { name: { contains: 'AZUCAR', mode: 'insensitive' } } });
  
  // Find all failed/pending assembly RPA executions
  const badExecutions = await prisma.rpaExecution.findMany({
    where: { executionType: 'SIIGO_ASSEMBLY', status: { not: 'COMPLETED' } },
    include: {
      assemblyNote: true
    }
  });
  
  // They are attached to ENSAMBLE notes. We need the batch ID of those notes.
  const badBatchIds = badExecutions.filter(e => e.assemblyNote && e.assemblyNote.productionBatchId).map(e => e.assemblyNote.productionBatchId);
  // Distinct batch IDs
  const uniqueBadBatchIds = [...new Set(badBatchIds)];

  console.log(`Found ${uniqueBadBatchIds.length} batches with failed/pending RPAs.`);

  // Sum up sugar used in PESAJE or anywhere else in those batches
  const missingSugarItems = await prisma.assemblyNoteItem.findMany({
    where: {
      componentId: sugar.id,
      assemblyNote: {
        productionBatchId: { in: uniqueBadBatchIds },
        status: 'COMPLETED' // only count if the pesaje was completed
      }
    },
    include: {
        assemblyNote: {
            include: { productionBatch: true }
        }
    }
  });

  let totalSugar = 0;
  for (const item of missingSugarItems) {
      totalSugar += item.actualQuantity || 0;
      console.log(`Batch ${item.assemblyNote.productionBatch.batchNumber}: used ${item.actualQuantity}g of sugar`);
  }
  
  console.log(`\nTotal sugar missing in Siigo purely due to failed RPAs: ${totalSugar}g`);

  // What about batches that finished COMPLETELY locally but NEVER fired an RPA?
  // (e.g. they don't have ANY rpaExecutions).
  // E.g. Geniality per-carrito RPAs, or manual skips.
  
}

main().catch(console.error).finally(() => prisma.$disconnect());
