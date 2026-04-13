const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.rpaExecution.findMany({
  where: { productName: 'BASE SIROPE CLASICA', assemblyNoteId: { not: null } },
  orderBy: { startedAt: 'desc' }
}).then(res => console.log(res.map(r => ({id: r.id, startedAt: r.startedAt, status: r.status, note: r.assemblyNoteId})))).finally(() => prisma.$disconnect());
