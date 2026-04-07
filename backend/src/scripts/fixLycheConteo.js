const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

p.assemblyNote.findFirst({
  where: { productionBatch: { batchNumber: 'LYCHE-260325-1103' }, processType: { code: 'EMPAQUE' } },
  select: { id: true, processParameters: true }
}).then(async n => {
  if (!n) { console.log('no encontrado'); return; }
  const ep = n.processParameters || {};
  await p.assemblyNote.update({
    where: { id: n.id },
    data: { processParameters: {
      ...ep,
      empaqueRef: { ...ep.empaqueRef, conteo_qty: 346 },
      empaque: { ...ep.empaque, conteo_qty: 346, approved_qty: 346 }
    }}
  });
  console.log('processParameters actualizado → 346');
}).finally(() => p.$disconnect());
