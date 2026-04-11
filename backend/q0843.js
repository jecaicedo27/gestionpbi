const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const batch = await prisma.productionBatch.findUnique({
    where: { batchNumber: 'COCO-260410-0843' },
    include: {
      assemblyNotes: {
        include: { processType: true },
        orderBy: { stageOrder: 'asc' }
      }
    }
  });
  if(!batch) return console.log('no batch');
  console.log('BATCH:', batch.batchNumber, batch.status);
  batch.assemblyNotes.forEach((n) => {
    console.log('[' + n.stageOrder + '] ' + n.processType?.code + ' // ' + n.status + ' // ' + n.stageName);
  });
}
run();
