const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.materialLot.updateMany({
  where: { lotNumber: { startsWith: 'MANUAL-BASE-11APR' } },
  data: { zone: 'PRODUCTION' }
}).then(res => console.log('Updated lots to PRODUCTION zone:', res)).catch(console.error).finally(() => prisma.$disconnect());
