const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.rpaExecution.findMany({
  where: { productName: 'BASE SIROPE CLASICA' },
  orderBy: { startedAt: 'desc' },
  take: 2,
  include: { assemblyNote: { select: { stageName: true, processType: { select: { code: true } } } } }
}).then(res => console.log(JSON.stringify(res, null, 2))).catch(console.error).finally(() => prisma.$disconnect());
