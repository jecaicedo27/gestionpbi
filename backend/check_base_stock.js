const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.product.findUnique({
  where: { sku: 'PROCEGENIALITY01' }
}).then(res => console.log('Current Stock Info:', res.productionZoneStock)).catch(console.error).finally(() => prisma.$disconnect());
