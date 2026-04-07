const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

p.$connect().then(async () => {
  // Get the two sub-lots of 090326 PRODUCCION
  const lots = await p.$queryRaw`
    SELECT ml.id, ml."initialQuantity", ml."currentQuantity", ml."lotNumber"
    FROM material_lots ml
    INNER JOIN products pr ON pr.id = ml."productId"
    WHERE ml."lotNumber" = '090326' AND ml.zone = 'PRODUCTION' AND pr.name = 'AZUCAR'
  `;

  const lotIds = lots.map(l => l.id);

  // All individual consumption records (not grouped)
  const cons = await p.$queryRaw`
    SELECT lc.id, lc."quantityUsed", lc."usedAt", lc."assemblyNoteId", lc."materialLotId",
           ml."initialQuantity" as lot_ini
    FROM lot_consumptions lc
    INNER JOIN material_lots ml ON ml.id = lc."materialLotId"
    INNER JOIN products pr ON pr.id = ml."productId"
    WHERE ml."lotNumber" = '090326' AND ml.zone = 'PRODUCTION' AND pr.name = 'AZUCAR'
    ORDER BY lc."usedAt" ASC
  `;

  console.log('=== Consumos individuales (lote 090326 AZUCAR PRODUCCION) ===');
  let total = 0;
  for (const c of cons) {
    const dt = c.usedAt ? new Date(c.usedAt).toISOString().slice(0,16) : 'n/a';
    const nota = String(c.assemblyNoteId).slice(0,8);
    const sublot = String(c.materialLotId).slice(0,8);
    console.log(`  [${dt}] ${c.quantityUsed}g | sublote:${sublot}(ini:${c.lot_ini}) | nota:${nota}`);
    total += Number(c.quantityUsed);
  }
  
  const totalInicial = lots.reduce((s,l) => s + Number(l.initialQuantity), 0);
  const totalActual = lots.reduce((s,l) => s + Number(l.currentQuantity), 0);
  console.log('\nTotal consumos registrados: ' + total + 'g');
  console.log('Esperado (inicial-actual):  ' + (totalInicial - totalActual) + 'g');
  console.log('Diferencia (sin registros): ' + ((totalInicial - totalActual) - total) + 'g');

  // Check note cd7f5688 details
  const note = await p.assemblyNote.findFirst({
    where: { id: { startsWith: 'cd7f5688' }},
    select: { noteNumber: true, stageName: true, status: true, completedAt: true, productionBatch: { select: { batchNumber: true } } }
  });
  console.log('\nNota CD7F5688:', note?.stageName, '| batch:', note?.productionBatch?.batchNumber, '| status:', note?.status);

  await p.$disconnect();
}).catch(e => { console.error(e.message); process.exit(1); });
