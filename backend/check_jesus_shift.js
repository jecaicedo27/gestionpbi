const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  // When did Jesus complete the CONTEO? (UTC: 2026-04-11T02:55:56 = Colombia: 2026-04-10 21:55)
  const conteoTime = new Date('2026-04-11T02:55:56.800Z');
  const colombiaHour = (conteoTime.getUTCHours() - 5 + 24) % 24;
  console.log(`CONTEO completado en Colombia: ${conteoTime.toLocaleDateString('es-CO')} a las ${colombiaHour}:${String(conteoTime.getUTCMinutes()).padStart(2,'0')}`);

  // Find Jesus Canchila user
  const jesus = await prisma.user.findFirst({
    where: { name: { contains: 'JESUS', mode: 'insensitive' } },
    select: { id: true, name: true, role: true }
  });
  console.log('\nUsuario:', jesus);

  // Check ShiftEmployee for Jesus
  const shiftEmployee = await prisma.shiftEmployee.findFirst({
    where: { userId: jesus?.id },
    include: { shift: { select: { name: true, startTime: true, endTime: true } } }
  });
  console.log('Turno asignado:', shiftEmployee);

  // Check all assembly notes executed by Jesus on this batch
  const notes = await prisma.assemblyNote.findMany({
    where: {
      executedById: jesus?.id,
      productionBatch: { batchNumber: 'MANGO-BICHE-260410-0711' }
    },
    include: { processType: { select: { code: true } } },
    orderBy: { startedAt: 'asc' }
  });

  console.log('\nNotas ejecutadas por Jesus en este batch:');
  notes.forEach(n => {
    const startCO = n.startedAt ? new Date(new Date(n.startedAt).getTime() - 5*3600000) : null;
    const endCO = n.completedAt ? new Date(new Date(n.completedAt).getTime() - 5*3600000) : null;
    console.log(`- [${n.processType?.code}] ${n.stageName}: inicio ${startCO?.toLocaleTimeString('es-CO')} | fin ${endCO?.toLocaleTimeString('es-CO')} | status: ${n.status}`);
  });

  // Also check all assembly activity by Jesus in last 24h
  const since = new Date(Date.now() - 24*3600*1000);
  const allActivity = await prisma.assemblyNote.findMany({
    where: { executedById: jesus?.id, startedAt: { gte: since } },
    include: { 
      processType: { select: { code: true } },
      productionBatch: { select: { batchNumber: true } }
    },
    orderBy: { startedAt: 'asc' }
  });

  console.log('\nToda la actividad de Jesus (últimas 24h):');
  allActivity.forEach(n => {
    const startCO = n.startedAt ? new Date(new Date(n.startedAt).getTime() - 5*3600000) : null;
    const endCO = n.completedAt ? new Date(new Date(n.completedAt).getTime() - 5*3600000) : null;
    console.log(`- [${n.processType?.code}] ${n.productionBatch?.batchNumber} | inicio ${startCO?.toLocaleTimeString('es-CO')} | fin ${endCO?.toLocaleTimeString('es-CO')}`);
  });
}

check().catch(console.error).finally(() => prisma.$disconnect());
