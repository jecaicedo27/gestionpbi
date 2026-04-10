const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.auditLog.findMany({
    where: { 
      action: { in: ['EMPAQUE_CARRITO_CONSUMED', 'G_EMPAQUE_CARRITO_CONSUMED', 'CONSUMPTION_ALERT'] },
      createdAt: { gte: new Date(Date.now() - 4 * 60 * 60 * 1000) } // last 4 hours
    },
    orderBy: { createdAt: 'desc' }
  });
  console.log(JSON.stringify(logs, null, 2));

  // Let's also find recent AssemblyNotes that completed
  const notes = await prisma.assemblyNote.findMany({
      where: {
          processType: { code: 'EMPAQUE' },
          updatedAt: { gte: new Date(Date.now() - 4 * 60 * 60 * 1000) }
      },
      select: { id: true, noteNumber: true, status: true, targetQuantity: true, actualQuantity: true, processParameters: true }
  });
  console.log("Recent EMPAQUE Notes:");
  console.log(JSON.stringify(notes, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
