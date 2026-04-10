const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const BATCH = 'MANGO-BICHE-260406-1621';

    // Find the EMPAQUE 360ml note
    const batch = await prisma.productionBatch.findFirst({ where: { batchNumber: BATCH }, select: { id: true } });
    const note360 = await prisma.assemblyNote.findFirst({
        where: {
            productionBatchId: batch.id,
            processType: { code: 'EMPAQUE' },
            product: { name: { contains: '360' } }
        },
        include: { items: { include: { component: { select: { id: true, name: true } } } } }
    });
    console.log('Nota 360 ML:', note360?.id, note360?.actualQuantity, note360?.targetQuantity);

    // Real qty from carriots
    const conteoNote = await prisma.assemblyNote.findFirst({
        where: { productionBatchId: batch.id, processType: { code: 'CONTEO' } },
        select: { processParameters: true }
    });
    const carriots = conteoNote?.processParameters?.carriots || [];
    const carriots360 = carriots.filter(c => c.productId === note360?.productId && c.receivedAt);
    const realQty = carriots360.reduce((s, c) => s + (c.qty || 0), 0);
    console.log(`Real producido 360ml: ${realQty} (carriots: ${carriots360.map(c=>c.qty).join('+')})`);

    // Find existing LotConsumption that shows 100 tarros
    const tarroItem = note360?.items.find(i => /TARRO/i.test(i.component?.name) && /360/i.test(i.component?.name));
    if (!tarroItem) { console.log('No se encontró el item de tarro 360'); return; }

    const existing = await prisma.lotConsumption.findFirst({
        where: { assemblyNoteId: note360.id, materialLot: { productId: tarroItem.componentId } },
        include: { materialLot: { select: { lotNumber: true } } }
    });
    console.log(`LotConsumption actual: ${existing?.quantityUsed} uds (lot: ${existing?.materialLot?.lotNumber})`);

    if (existing && existing.quantityUsed !== realQty) {
        await prisma.lotConsumption.update({
            where: { id: existing.id },
            data: { 
                quantityUsed: realQty,
                observations: `Corregido: consumo real ${realQty} uds (era ${existing.quantityUsed}). Lote: ${BATCH}.`
            }
        });
        console.log(`✅ Corregido: ${existing.quantityUsed} → ${realQty} tarros GENIALITY 360 ML`);
    } else {
        console.log('No necesita corrección o ya está correcto.');
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
