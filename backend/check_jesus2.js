const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  // CONTEO completado: 10/04/2026 a las 21:55 Colombia (turno de noche)
  
  const jesus = await prisma.user.findFirst({
    where: { name: { contains: 'JESUS', mode: 'insensitive' } },
    select: { id: true, name: true, role: true }
  });

  // Check ShiftEmployee without include
  const shiftEmployee = await prisma.shiftEmployee.findFirst({
    where: { userId: jesus?.id }
  });
  console.log('ShiftEmployee record:', JSON.stringify(shiftEmployee, null, 2));

  // Activity of Jesus in last 48h
  const since = new Date(Date.now() - 48*3600*1000);
  const allActivity = await prisma.assemblyNote.findMany({
    where: { executedById: jesus?.id, startedAt: { gte: since } },
    include: { processType: { select: { code: true } }, productionBatch: { select: { batchNumber: true } } },
    orderBy: { startedAt: 'asc' }
  });

  console.log(`\nActividad de ${jesus?.name} (últimas 48h):`);
  allActivity.forEach(n => {
    const toLocal = (d) => d ? new Date(new Date(d).getTime() - 5*3600000).toLocaleString('es-CO') : '—';
    console.log(`  [${n.processType?.code}] ${n.productionBatch?.batchNumber}`);
    console.log(`    Inicio: ${toLocal(n.startedAt)} | Fin: ${toLocal(n.completedAt)} | Status: ${n.status}`);
  });
}
check().catch(console.error).finally(() => prisma.$disconnect());
