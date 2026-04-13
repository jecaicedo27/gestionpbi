const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.assemblyNote.findUnique({
  where: { id: '84841ae5-5d01-4fd9-9961-2f1de8e7a228' },
  include: { product: true }
}).then(res => console.log(JSON.stringify(res, null, 2))).catch(console.error).finally(() => prisma.$disconnect());
