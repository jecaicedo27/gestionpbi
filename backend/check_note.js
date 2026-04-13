const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.assemblyNote.findFirst({
  where: { 
    stageName: { contains: 'BASE SIROPE CLASICA' },
    status: 'COMPLETED'
  },
  orderBy: { completedAt: 'desc' },
  include: { processType: true, product: true }
}).then(note => console.log(JSON.stringify(note, null, 2))).catch(console.error).finally(() => prisma.$disconnect());
