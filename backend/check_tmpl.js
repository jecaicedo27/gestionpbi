const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.assemblyTemplate.findUnique({
  where: { templateCode: 'TMPL068' },
  include: { stages: { include: { processType: true } } }
}).then(res => console.log(JSON.stringify(res, null, 2))).catch(console.error).finally(() => prisma.$disconnect());
