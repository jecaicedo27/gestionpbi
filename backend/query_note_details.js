const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const note = await prisma.assemblyNote.findFirst({
      where: { noteNumber: 'MANGO-BICHE-CON-SAL-260408-2324-S11' },
      include: { items: { include: { component: { select: { name: true } } } }, processType: true }
  });
  
  console.log(JSON.stringify(note, null, 2));

  // let's look for audit logs of EMPAQUE for that specific note to see if any consumption alerts were generated.
  const audit = await prisma.auditLog.findMany({
      where: { entityId: note.id },
      orderBy: { createdAt: 'desc' }
  });
  console.log("\nAudit Logs for this note:");
  console.log(JSON.stringify(audit, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
