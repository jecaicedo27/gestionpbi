const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.assemblyTemplate.findFirst({
  where: { templateName: { contains: 'BASE SIROPE CLASICA' } },
  include: { stages: { orderBy: { stageOrder: 'asc' }, include: { processType: true } } }
}).then(res => console.log(JSON.stringify(res, null, 2))).catch(console.error).finally(() => prisma.$disconnect());
