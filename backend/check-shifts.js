const {PrismaClient} = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const w = await p.shiftWeek.findUnique({
    where: { id: 'b9e1a898-1535-447f-83f8-5fe550286f00' },
    include: {
      assignments: {
        include: {
          employee: {
            include: { user: { select: { id: true, name: true, pin: true } } }
          }
        }
      }
    }
  });

  const byShift = {};
  w.assignments.forEach(a => {
    const key = a.shift;
    if (!byShift[key]) byShift[key] = [];
    byShift[key].push({
      name: a.employee?.name,
      area: a.area,
      role: a.employee?.role,
      hasPin: !!a.employee?.user?.pin,
      userId: a.employee?.userId
    });
  });

  Object.keys(byShift).sort().forEach(shift => {
    console.log(`\n--- Turno: ${shift} ---`);
    byShift[shift].forEach(e => {
      console.log(`  ${e.name} | ${e.area} | ${e.role} | PIN: ${e.hasPin ? 'Y' : 'N'} | userId: ${e.userId || 'NONE'}`);
    });
  });

  // Show today's handoffs
  const today = new Date('2026-04-14T00:00:00');
  const handoffs = await p.shiftHandoff.findMany({
    where: { weekId: w.id, date: today },
    include: {
      deliveredBy: { select: { name: true } },
      outgoingLeader: { select: { name: true } },
      incomingLeader: { select: { name: true } }
    }
  });
  console.log(`\n--- Handoffs de hoy --- (${handoffs.length})`);
  handoffs.forEach(h => {
    console.log(`  ${h.area} | ${h.outgoingShift} | ${h.status} | Entregó: ${h.deliveredBy?.name} | Líder saliente: ${h.outgoingLeader?.name || '-'} | Líder entrante: ${h.incomingLeader?.name || '-'}`);
  });

  process.exit(0);
})();
