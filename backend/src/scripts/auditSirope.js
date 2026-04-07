const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const siropeId = '6a492be8-34e2-41e1-8d09-9ac7f3dfeac7';
  const batches = await p.productionBatch.findMany({
    where: { createdAt: { gte: new Date('2026-03-30T00:00:00') } },
    select: { id: true, batchNumber: true, flavor: true },
    orderBy: { createdAt: 'asc' }
  });
  console.log('=== SIROPE: PRODUCIDO vs CONSUMIDO por batch ===');
  for (const b of batches) {
    const siropeNote = await p.assemblyNote.findFirst({
      where: { productionBatchId: b.id, productId: siropeId, status: 'COMPLETED' },
      select: { actualQuantity: true, targetQuantity: true }
    });
    const batchNotes = await p.assemblyNote.findMany({
      where: { productionBatchId: b.id }, select: { id: true }
    });
    let consumed = 0;
    if (batchNotes.length > 0) {
      const cons = await p.lotConsumption.findMany({
        where: { assemblyNoteId: { in: batchNotes.map(n => n.id) }, materialLot: { productId: siropeId } },
        select: { quantityUsed: true }
      });
      consumed = cons.reduce((s, c) => s + c.quantityUsed, 0);
    }
    if (siropeNote || consumed > 0) {
      const produced = siropeNote?.actualQuantity || 0;
      const target = siropeNote?.targetQuantity || 0;
      const diff = produced - consumed;
      const flag = !siropeNote ? ' *** NO SIROPE NOTE' : (diff < -1000 ? ' *** DEFICIT' : '');
      console.log(b.batchNumber, '|', b.flavor, '| target:', target, '| produced:', produced, '| consumed:', consumed, '| net:', diff, flag);
    }
  }
  const pending = await p.assemblyNote.findMany({
    where: { productId: siropeId, status: { not: 'COMPLETED' } },
    select: { status: true, targetQuantity: true, stageName: true, productionBatch: { select: { batchNumber: true } } }
  });
  console.log('\nNotas PENDIENTES:', pending.length);
  pending.forEach(n => console.log(' ', n.status, '| target:', n.targetQuantity, '| batch:', n.productionBatch?.batchNumber));
  const todayLots = await p.materialLot.findMany({
    where: { productId: siropeId, receivedAt: { gte: new Date('2026-03-31T00:00:00') } },
    select: { initialQuantity: true, lotNumber: true }
  });
  console.log('\nProducido hoy:', todayLots.reduce((s,l) => s + l.initialQuantity, 0), 'g');
  todayLots.forEach(l => console.log('  ', l.lotNumber, ':', l.initialQuantity));
  const cons2 = await p.lotConsumption.findMany({
    where: { materialLot: { productId: siropeId }, usedAt: { gte: new Date('2026-03-31T00:00:00') } },
    select: { quantityUsed: true }
  });
  console.log('Consumido hoy:', cons2.reduce((s,c) => s + c.quantityUsed, 0), 'g');
  await p.$disconnect();
})();
