const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.assemblyNote.findMany({
  where: { 
    productionBatch: { batchNumber: 'MARACUYA-260410-1623' }
  },
  orderBy: { stageOrder: 'asc' },
  select: { stageOrder: true, stageName: true, processType: { select: { code: true } } }
}).then(res => console.log('YESTERDAY BATCH:', JSON.stringify(res, null, 2))).catch(console.error).finally(() => prisma.$disconnect());
