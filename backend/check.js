const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const batch = await prisma.productionBatch.findFirst({
    where: { batchNumber: 'CEREZA-260407-0953' }
  });
  const notes = await prisma.assemblyNote.findMany({
    where: { productionBatchId: batch.id, processType: { code: 'EMPAQUE' } },
    include: { product: { select: { name: true } } }
  });
  notes.forEach(n => {
     console.log(n.product?.name);
     console.log('assembly_on_complete =', n.processParameters?.assembly_on_complete);
  });
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
