const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.assemblyTemplateStage.findMany({
  where: { processType: { code: 'ENSAMBLE' } },
  include: { processType: true, template: { select: { templateName: true, productId: true } } }
}).then(res => console.log(JSON.stringify(res.slice(0, 5), null, 2))).catch(console.error).finally(() => prisma.$disconnect());
