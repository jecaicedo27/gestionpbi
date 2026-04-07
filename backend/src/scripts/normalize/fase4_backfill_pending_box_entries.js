/**
 * Backfill Fase 4: PendingBox.entries Json → tabla PendingBoxEntry
 * Migra las 6 filas existentes de pending_boxes.entries (JSON)
 * a la nueva tabla pending_box_entries ANTES de que se droppee la columna.
 *
 * EJECUTAR ANTES de aplicar la migration que hace DROP COLUMN "entries".
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🔄 Backfill Fase 4: PendingBox.entries → PendingBoxEntry\n');

    // Leer los datos actuales desde la columna JSON directamente por SQL
    const rawBoxes = await prisma.$queryRaw`
        SELECT id, entries FROM pending_boxes WHERE entries IS NOT NULL
    `;

    console.log(`📊 Boxes con entries JSON: ${rawBoxes.length}`);

    let totalEntries = 0;

    for (const box of rawBoxes) {
        const entries = box.entries; // Ya viene parseado de jsonb por Prisma

        if (!Array.isArray(entries) || entries.length === 0) {
            console.log(`  ⚠️  Box ${box.id.slice(0, 8)} sin entries. Skipping.`);
            continue;
        }

        const created = await prisma.pendingBoxEntry.createMany({
            data: entries.map(e => ({
                boxId: box.id,
                lot: String(e.lot || ''),
                qty: parseInt(e.qty) || 0,
                expiry: e.expiry ? new Date(e.expiry) : null,
            })),
        });

        totalEntries += created.count;
        console.log(`  ✅ Box ${box.id.slice(0, 8)} → ${created.count} entries migradas (${entries.map(e => `${e.lot}×${e.qty}`).join(', ')})`);
    }

    // Verificación
    const totalInDB = await prisma.pendingBoxEntry.count();
    console.log(`\n📋 Resumen:`);
    console.log(`   Boxes procesadas: ${rawBoxes.length}`);
    console.log(`   Entries creadas: ${totalEntries}`);
    console.log(`   Total en pending_box_entries: ${totalInDB}`);

    if (totalEntries === totalInDB) {
        console.log(`\n✅ ÉXITO: Todos los entries migrados correctamente.`);
        console.log(`   Ahora es seguro aplicar: DROP COLUMN "entries" en pending_boxes.`);
    } else {
        console.log(`\n⚠️  ATENCIÓN: Discrepancia. Revisar antes de dropar la columna.`);
    }
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
