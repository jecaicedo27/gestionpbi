const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const batch = await prisma.productionBatch.findFirst({
    where: { batchNumber: 'MANGO-BICHE-260410-0711' },
    include: {
      assemblyNotes: {
        where: { processType: { code: 'EMPAQUE' } },
        include: {
          processType: { select: { code: true } },
          executedBy: { select: { name: true } },
          completedBy: { select: { name: true } }
        },
        orderBy: { stageOrder: 'asc' }
      }
    }
  });

  for (const n of batch.assemblyNotes) {
    console.log('\n=== ' + n.stageName + ' ===');
    console.log('Status:', n.status, '| Inicio:', n.startedAt, '| Completado:', n.completedAt);
    console.log('Ejecutado por:', n.executedBy?.name || 'Sin asignar');
    console.log('Completado por:', n.completedBy?.name || 'Sin completar');
    console.log('Target:', n.targetQuantity, '| Real:', n.actualQuantity);
    console.log('ProcessParams:', JSON.stringify(n.processParameters, null, 2));
  }
}
check().catch(console.error).finally(() => prisma.$disconnect());
