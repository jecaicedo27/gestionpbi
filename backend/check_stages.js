const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.assemblyTemplateStage.findMany({
  where: { templateId: 'e0c6aa1b-9a5c-4530-b86f-fdbe93662a06' },
  include: { processType: true }
}).then(res => console.log(JSON.stringify(res, null, 2))).catch(console.error).finally(() => prisma.$disconnect());
