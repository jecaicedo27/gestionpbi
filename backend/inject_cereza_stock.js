const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const LOT = 'CEREZA-260407-0953';

async function inject() {
    const batch = await prisma.productionBatch.findFirst({
        where: { batchNumber: LOT },
        select: { id: true, batchNumber: true }
    });
    if (!batch) { console.error('❌ Batch no encontrado'); return; }

    // Solo notas EMPAQUE COMPLETED (carritos ya procesados físicamente)
    const empNotes = await prisma.assemblyNote.findMany({
        where: {
            productionBatchId: batch.id,
            processType: { code: 'EMPAQUE' },
            status: 'COMPLETED'  // Solo los que ya terminaron
        },
        include: {
            product: { select: { id: true, sku: true, name: true, accountGroup: true } }
        }
    });

    console.log(`=== Notas EMPAQUE COMPLETADAS del lote ${LOT} ===`);
    for (const note of empNotes) {
        console.log(`\n  → ${note.product?.sku} (${note.product?.name}) | ${note.actualQuantity} uds`);

        if (!note.productId || !note.actualQuantity) {
            console.log(`    ⚠️ Saltando — sin productId o cantidad`);
            continue;
        }

        // Verificar si ya existe stock
        const existing = await prisma.finishedLotStock.findUnique({
            where: {
                productId_lotNumber_zone: {
                    productId: note.productId,
                    lotNumber: LOT,
                    zone: 'PRODUCCION'
                }
            }
        });

        let stockId;
        const qty = note.actualQuantity;

        if (existing) {
            const newInit = existing.initialQuantity + qty;
            const newCurr = existing.currentQuantity + qty;
            const updated = await prisma.finishedLotStock.update({
                where: { id: existing.id },
                data: {
                    initialQuantity: newInit,
                    currentQuantity: newCurr,
                    status: 'AVAILABLE',
                    batchId: batch.id
                }
            });
            stockId = updated.id;
            console.log(`    ✅ Incrementado: ${newCurr} uds totales en PRODUCCION`);
        } else {
            const created = await prisma.finishedLotStock.create({
                data: {
                    productId: note.productId,
                    lotNumber: LOT,
                    zone: 'PRODUCCION',
                    initialQuantity: qty,
                    currentQuantity: qty,
                    batchId: batch.id,
                    status: 'AVAILABLE'
                }
            });
            stockId = created.id;
            console.log(`    ✅ Creado: ${qty} uds en PRODUCCION`);
        }

        // Audit log — el schema de FinishedLotTransfer requiere productId en connect form
        await prisma.finishedLotTransfer.create({
            data: {
                finishedLotStockId: stockId,
                product: { connect: { id: note.productId } },
                lotNumber: LOT,
                fromZone: 'PRODUCCION',
                toZone: 'PRODUCCION',
                quantity: qty,
                reason: `Recuperacion manual — EMPAQUE completado, lote ${LOT}`
            }
        });
    }

    // Resultado final
    console.log('\n=== Stock PRODUCCION final ===');
    const finalStocks = await prisma.finishedLotStock.findMany({
        where: { lotNumber: LOT, zone: 'PRODUCCION' },
        include: { product: { select: { sku: true, name: true } } }
    });
    if (finalStocks.length === 0) {
        console.log('  (ninguno — revisar manualmente)');
    } else {
        finalStocks.forEach(s => {
            console.log(`  ✅ ${s.product?.sku} | ${s.currentQuantity} uds disponibles para entrega a logística`);
        });
    }
}

inject().catch(console.error).finally(() => prisma.$disconnect());
