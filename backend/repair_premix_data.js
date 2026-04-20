/**
 * Repair script for premix ENSAMBLE notes damaged by the resolveEnsambleQty COCCION bug.
 *
 * The bug caused COCCION's actualQuantity (typically 1 "lote") to be used as ENSAMBLE's
 * actualQuantity instead of the real targetQuantity. This corrupted:
 *   1. AssemblyNote.actualQuantity
 *   2. MaterialLot.initialQuantity + currentQuantity
 *   3. Product.productionZoneStock
 *
 * Identified 12 damaged notes across 6 products.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DAMAGED_NOTES = [
  // AZUCAR INVERTER GLUCOSA
  { noteNumber: 'AZUCAR-INVERTER-GLUC-260414-1238-S7', wrongActual: 4,  correctActual: 553184 },
  // ALGINATO PREPARADO
  { noteNumber: 'ALGINATO-PREPARADO-260415-1447-S6',   wrongActual: 1,  correctActual: 100970 },
  { noteNumber: 'ALGINATO-PREPARADO-260415-1107-S6',   wrongActual: 1,  correctActual: 100970 },
  { noteNumber: 'ALGINATO-PREPARADO-260414-0146-S6',   wrongActual: 1,  correctActual: 100970 },
  { noteNumber: 'ALGINATO-PREPARADO-260413-1812-S6',   wrongActual: 1,  correctActual: 100970 },
  // PREMEZCLA GOMAS PARA PERLAS
  { noteNumber: 'GOMAS-260414-1648-S7',                wrongActual: 1,  correctActual: 6 },
  { noteNumber: 'GOMAS-260413-1732-S8',                wrongActual: 1,  correctActual: 7 },
  // PREMEZCLA FUENTE DE CALCIO PERLAS
  { noteNumber: 'FUENTE-DE-CALCIO-260414-1610-S7',     wrongActual: 1,  correctActual: 6 },
  { noteNumber: 'FUENTE-DE-CALCIO-260413-1650-S8',     wrongActual: 1,  correctActual: 7 },
  // PREMEZCLA CONSERVANTES PERLAS
  { noteNumber: 'CONSERVANTES-260414-1746-S5',          wrongActual: 1,  correctActual: 4 },
  { noteNumber: 'CONSERVANTES-260413-1811-S8',          wrongActual: 1,  correctActual: 7 },
  // BASE LIQUIPOPS (CHICLE)
  { noteNumber: 'CHICLE-260407-0914-S4',                wrongActual: 1,  correctActual: 118005 },
];

// Add computed delta
DAMAGED_NOTES.forEach(n => { n.delta = n.correctActual - n.wrongActual; });

async function repair() {
  console.log('=== REPAIR SCRIPT: Premix ENSAMBLE data ===\n');

  const productDeltas = {};
  let repaired = 0;
  let skipped = 0;

  for (const entry of DAMAGED_NOTES) {
    const note = await prisma.assemblyNote.findUnique({
      where: { noteNumber: entry.noteNumber },
      include: { product: true },
    });

    if (!note) {
      console.error(`❌ Note ${entry.noteNumber} NOT FOUND — skipping`);
      skipped++;
      continue;
    }

    // Safety: confirm actualQuantity matches expected wrong value
    if (note.actualQuantity !== entry.wrongActual) {
      console.warn(`⚠️  Note ${entry.noteNumber}: actualQuantity=${note.actualQuantity}, expected ${entry.wrongActual} — SKIPPING (may already be fixed)`);
      skipped++;
      continue;
    }

    // Safety: confirm targetQuantity matches correctActual
    if (note.targetQuantity !== entry.correctActual) {
      console.warn(`⚠️  Note ${entry.noteNumber}: targetQuantity=${note.targetQuantity}, expected ${entry.correctActual} — SKIPPING`);
      skipped++;
      continue;
    }

    console.log(`\n--- Repairing ${entry.noteNumber} ---`);
    console.log(`  Product: ${note.product.name}`);
    console.log(`  actualQuantity: ${entry.wrongActual} → ${entry.correctActual} (delta +${entry.delta})`);

    // 1. Update AssemblyNote.actualQuantity
    await prisma.assemblyNote.update({
      where: { noteNumber: entry.noteNumber },
      data: { actualQuantity: entry.correctActual },
    });
    console.log(`  ✅ AssemblyNote.actualQuantity updated`);

    // 2. Find and fix the MaterialLot
    // lotNumber is the batchNumber (noteNumber minus the stage suffix)
    const batchNumber = entry.noteNumber.replace(/-S\d+$/, '');
    const lot = await prisma.materialLot.findFirst({
      where: { lotNumber: batchNumber },
    });

    if (lot) {
      if (lot.initialQuantity === entry.wrongActual) {
        const newInitial = entry.correctActual;
        const newCurrent = lot.currentQuantity + entry.delta;

        await prisma.materialLot.update({
          where: { id: lot.id },
          data: {
            initialQuantity: newInitial,
            currentQuantity: newCurrent,
          },
        });
        console.log(`  ✅ MaterialLot (${batchNumber}): initial ${lot.initialQuantity}→${newInitial}, current ${lot.currentQuantity}→${newCurrent}`);
      } else {
        console.warn(`  ⚠️  MaterialLot initialQuantity=${lot.initialQuantity}, expected ${entry.wrongActual} — SKIPPING lot update`);
      }
    } else {
      // Try with the full noteNumber
      const lotAlt = await prisma.materialLot.findFirst({
        where: { lotNumber: entry.noteNumber },
      });
      if (lotAlt) {
        if (lotAlt.initialQuantity === entry.wrongActual) {
          const newInitial = entry.correctActual;
          const newCurrent = lotAlt.currentQuantity + entry.delta;
          await prisma.materialLot.update({
            where: { id: lotAlt.id },
            data: { initialQuantity: newInitial, currentQuantity: newCurrent },
          });
          console.log(`  ✅ MaterialLot (${entry.noteNumber}): initial ${lotAlt.initialQuantity}→${newInitial}, current ${lotAlt.currentQuantity}→${newCurrent}`);
        } else {
          console.warn(`  ⚠️  MaterialLot initialQuantity=${lotAlt.initialQuantity}, expected ${entry.wrongActual} — SKIPPING lot update`);
        }
      } else {
        console.warn(`  ⚠️  No MaterialLot found for lotNumber="${batchNumber}" or "${entry.noteNumber}"`);
      }
    }

    // 3. Accumulate productionZoneStock delta
    const productId = note.productId;
    if (!productDeltas[productId]) {
      productDeltas[productId] = { name: note.product.name, delta: 0 };
    }
    productDeltas[productId].delta += entry.delta;
    repaired++;
  }

  // 4. Apply productionZoneStock corrections
  console.log('\n\n=== Updating productionZoneStock ===\n');
  for (const [productId, info] of Object.entries(productDeltas)) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      console.error(`❌ Product ${productId} not found`);
      continue;
    }

    const oldStock = product.productionZoneStock;
    const newStock = oldStock + info.delta;

    await prisma.product.update({
      where: { id: productId },
      data: { productionZoneStock: newStock },
    });
    console.log(`  ✅ ${info.name}: productionZoneStock ${oldStock} → ${newStock} (delta +${info.delta})`);
  }

  console.log(`\n\n=== REPAIR COMPLETE: ${repaired} repaired, ${skipped} skipped ===`);
}

repair()
  .catch(e => {
    console.error('REPAIR FAILED:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
