const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.auditLog.findMany({
  where: { OR: [{ entity: 'AssemblyTemplateStage' }, { entity: 'AssemblyTemplate' }], action: 'DELETE' },
  orderBy: { createdAt: 'desc' },
  take: 10
}).then(res => console.log(JSON.stringify(res, null, 2))).catch(console.error).finally(() => prisma.$disconnect());
