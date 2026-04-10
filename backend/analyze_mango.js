const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const BATCH = 'MANGO-BICHE-260406-1621';

    const batch = await prisma.productionBatch.findFirst({
        where: { batchNumber: BATCH },
        select: { id: true, batchNumber: true }
    });
    console.log('Batch ID:', batch?.id);

    // Get CONTEO note to extract carriots
    const conteoNote = await prisma.assemblyNote.findFirst({
        where: { productionBatchId: batch.id, processType: { code: 'CONTEO' } },
        select: { processParameters: true }
    });
    const allCarriots = conteoNote?.processParameters?.carriots || [];

    // Find all EMPAQUE notes
    const empaqueNotes = await prisma.assemblyNote.findMany({
        where: { productionBatchId: batch.id, processType: { code: 'EMPAQUE' } },
        include: {
            product: { select: { name: true, sku: true } },
            items: { include: { component: { select: { id: true, name: true, currentStock: true, productionZoneStock: true } } } }
        }
    });

    for (const note of empaqueNotes) {
        const productCarriots = allCarriots.filter(c => c.productId === note.productId && c.receivedAt);
        const realQty = productCarriots.reduce((s, c) => s + (c.qty || 0), 0) || note.actualQuantity || note.targetQuantity || 0;
        const ratio = note.targetQuantity > 0 ? realQty / note.targetQuantity : 1;
        const alreadyConsumedIds = note.processParameters?.carriots_consumed || [];
        
        console.log(`\n══ ${note.product?.name} ══`);
        console.log(`  Carriots recibidos: ${productCarriots.length} | Real: ${realQty} uds | Target: ${note.targetQuantity} | Ratio: ${ratio.toFixed(4)}`);
        console.log(`  carriots_consumed guardados: ${alreadyConsumedIds.length}`);
        
        for (const item of note.items) {
            const name = item.component?.name || '';
            const planned = item.plannedQuantity || 0;
            const qtyNeeded = Math.round(ratio * planned);
            const alreadyConsumed = item.consumed;
            console.log(`    [${alreadyConsumed ? 'OK' : 'FALTA'}] ${name}: plan=${planned} → necesita=${qtyNeeded} | consumed_flag=${alreadyConsumed} | stockActual=${item.component?.currentStock} zone=${item.component?.productionZoneStock}`);
        }
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
