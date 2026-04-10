const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const ADMIN_ID = 'fdbf8d09-5770-44d2-99e4-5dd7c9dbb2ab';

async function main() {
    const BATCH = 'MANGO-BICHE-260406-1621';
    const batch = await prisma.productionBatch.findFirst({ where: { batchNumber: BATCH }, select: { id: true } });

    const conteoNote = await prisma.assemblyNote.findFirst({
        where: { productionBatchId: batch.id, processType: { code: 'CONTEO' } },
        select: { processParameters: true }
    });
    const allCarriots = conteoNote?.processParameters?.carriots || [];

    const empaqueNotes = await prisma.assemblyNote.findMany({
        where: { productionBatchId: batch.id, processType: { code: 'EMPAQUE' } },
        include: {
            product: { select: { name: true } },
            items: { include: { component: { select: { id: true, name: true } } } }
        }
    });

    let totalFixed = 0;

    for (const note of empaqueNotes) {
        const productCarriots = allCarriots.filter(c => c.productId === note.productId && c.receivedAt);
        const realQty = productCarriots.reduce((s, c) => s + (c.qty || 0), 0) || note.actualQuantity || note.targetQuantity || 0;
        const ratio = note.targetQuantity > 0 ? realQty / note.targetQuantity : 1;

        console.log(`\n══ ${note.product?.name} (${realQty} uds producidas) ══`);

        for (const item of note.items) {
            if (!item.componentId) continue;
            const name = item.component?.name || '';
            if (name.toUpperCase() === 'AGUA') continue;

            const existing = await prisma.lotConsumption.findFirst({
                where: { assemblyNoteId: note.id, materialLot: { productId: item.componentId } }
            });
            if (existing) { console.log(`  ✓ Ya tiene: ${name}`); continue; }

            const qtyConsumed = Math.round(ratio * (item.plannedQuantity || 0));
            if (qtyConsumed <= 0) { console.log(`  ⏭ Sin cantidad: ${name}`); continue; }

            let lot = await prisma.materialLot.findFirst({
                where: { productId: item.componentId },
                orderBy: { receivedAt: 'desc' }
            });

            if (!lot) {
                lot = await prisma.materialLot.create({
                    data: {
                        productId: item.componentId,
                        lotNumber: `EMP-${BATCH}`,
                        zone: 'WAREHOUSE',
                        initialQuantity: qtyConsumed,
                        currentQuantity: 0,
                        siigoProductName: name,
                        siigoProductCode: 'EMP-GENIALITY',
                        receivedAt: new Date(),
                        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
                    }
                });
                console.log(`  + Lote virtual creado para ${name}`);
            }

            await prisma.lotConsumption.create({
                data: {
                    materialLot: { connect: { id: lot.id } },
                    assemblyNote: { connect: { id: note.id } },
                    usedBy: { connect: { id: ADMIN_ID } },
                    quantityUsed: qtyConsumed,
                    observations: `Consumo empaque Geniality — ${note.product?.name}. Real: ${realQty} uds. Lote: ${BATCH}.`
                }
            });

            console.log(`  ✅ ${name}: ${qtyConsumed} uds → trazabilidad registrada`);
            totalFixed++;
        }
    }

    console.log(`\n🎉 ${totalFixed} registros de trazabilidad creados para ${BATCH}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
