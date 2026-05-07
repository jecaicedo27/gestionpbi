const { PrismaClient } = require('@prisma/client');
const svc = require('../services/laborSummaryService');
const prisma = new PrismaClient();

(async () => {
  const r = await svc.getLaborSummary({ periodType: 'fortnight', anchorDate: '2026-05-07' });
  const ids = r.summary.filter(s => (s.overtimePendingHours || 0) > 0).map(s => s.employee.id);

  let created = 0, skipped = 0;
  const details = [];

  for (const empId of ids) {
    const detail = await svc.getLaborSummary({ periodType: 'fortnight', anchorDate: '2026-05-07', employeeId: empId });
    const d = detail.detail;
    if (!d) continue;

    for (const day of d.days) {
      // Solo días con overtimeStatus UNREGISTERED (sin approval) y extras > 0.05h
      if (day.overtimeStatus !== 'UNREGISTERED') continue;
      const dayH   = (day.extDayHours || 0) + (day.extSunDayHours || 0);
      const nightH = (day.extNightHours || 0) + (day.extSunNightHours || 0);
      const total  = dayH + nightH;
      if (total < 0.05) continue; // ignorar ruido <3 minutos

      // verificar que no exista ya approval ese día (defensivo)
      const dateLocal = new Date(`${day.date}T12:00:00-05:00`);
      const exists = await prisma.overtimeApproval.findFirst({
        where: { employeeId: empId, date: dateLocal },
      });
      if (exists) { skipped++; continue; }

      await prisma.overtimeApproval.create({
        data: {
          employeeId: empId,
          date: dateLocal,
          dayHours: +dayH.toFixed(2),
          nightHours: +nightH.toFixed(2),
          reason: 'Detección automática previa al sistema (antes de 2026-05-07)',
          category: 'MIGRACION_PRE_SISTEMA',
          status: 'PENDING',
        },
      });
      created++;
      details.push({ name: d.employee.name, date: day.date, day: dayH.toFixed(2), night: nightH.toFixed(2) });
    }
  }

  console.log('═══ Approvals huérfanas generadas ═══');
  console.log('Creadas:', created, '| Saltadas (ya existían):', skipped);
  console.table(details);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
