const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const PRODUCT_ID = '099da866-d2e0-4dba-8500-fb925275637e';
const DESDE = new Date('2026-03-10T00:00:00-05:00');

async function main() {
    // A. All ENSAMBLE notes from ALL MANGO-BICHE batches (not filtered by product)
    const mangoBatches = await p.productionBatch.findMany({
        where: { batchNumber: { contains: 'MANGO' }, createdAt: { gte: DESDE } },
        select: { id: true, batchNumber: true }
    });
    const batchIds = mangoBatches.map(b => b.id);
    console.log('Total batches MANGO:', mangoBatches.length, '->', mangoBatches.map(b => b.batchNumber).join(', '));

    const ensambles = await p.assemblyNote.findMany({
        where: {
            productionBatchId: { in: batchIds },
            processType: { code: 'ENSAMBLE' }
        },
        include: {
            productionBatch: { select: { batchNumber: true } },
            product: { select: { name: true, sku: true } }
        },
        orderBy: { createdAt: 'asc' }
    });
    console.log('\n=== ENSAMBLE SIIGO (todos los batches MANGO) ===');
    let totalSimulations = 0;
    ensambles.forEach(n => {
        const qty = n.actualQuantity || 0;
        totalSimulations += qty;
        console.log(
            n.productionBatch?.batchNumber,
            '| producto:', n.product?.sku, n.product?.name?.slice(0, 40),
            '| actual:', n.actualQuantity,
            '| status:', n.status
        );
    });
    console.log('TOTAL enviado a Siigo (sum actualQuantity):', totalSimulations);

    // B. Check SyrupLot for MANGO BICHE (production lot tracking)
    const syrupLots = await p.syrupLot.findMany({
        where: {
            OR: [
                { lotNumber: { contains: 'MANGO' } },
                { productId: PRODUCT_ID }
            ],
            createdAt: { gte: DESDE }
        },
        select: { lotNumber: true, quantity: true, remainingQuantity: true, productId: true, createdAt: true }
    }).catch(() => []);
    console.log('\n=== SYRUP LOTS (MANGO) ===');
    if (syrupLots.length === 0) console.log('(sin datos o tabla no aplica)');
    syrupLots.forEach(s => console.log(s.lotNumber, '| qty:', s.quantity, '| remaining:', s.remainingQuantity));

    // C. FinishedLotStock ALL zones for this product
    const allStock = await p.finishedLotStock.findMany({
        where: { productId: PRODUCT_ID },
        select: { lotNumber: true, zone: true, initialQuantity: true, currentQuantity: true, status: true, createdAt: true }
    });
    console.log('\n=== FINISHED LOT STOCK (todas las zonas) ===');
    let totalPT = 0;
    allStock.forEach(s => {
        if (s.zone === 'PRODUCTO_TERMINADO') totalPT += s.currentQuantity;
        console.log(s.lotNumber, '|', s.zone, '| init:', s.initialQuantity, '| current:', s.currentQuantity, '|', s.status);
    });
    console.log('TOTAL en PRODUCTO_TERMINADO (currentQuantity):', totalPT);

    // D. Handoff items (actas de entrega) for this product
    const handoffItems = await p.handoffItem.findMany({
        where: { productId: PRODUCT_ID },
        include: { handoff: { select: { handoffNumber: true, status: true, createdAt: true } } }
    });
    console.log('\n=== HANDOFF ITEMS (actas de entrega) ===');
    let sentToLogistics = 0;
    handoffItems.forEach(h => {
        const qty = h.receivedQuantity ?? h.requestedQuantity;
        if (h.handoff.status === 'COMPLETED') sentToLogistics += qty;
        console.log(h.handoff.handoffNumber, '| lot:', h.lotNumber, '| requested:', h.requestedQuantity, '| received:', h.receivedQuantity, '| status:', h.handoff.status);
    });
    console.log('TOTAL recibido por logística:', sentToLogistics);

    // E. Check assembly notes for 260319 batches specifically
    const b260319 = mangoBatches.filter(b => b.batchNumber.includes('260319'));
    if (b260319.length > 0) {
        const notes260319 = await p.assemblyNote.findMany({
            where: { productionBatchId: { in: b260319.map(b => b.id) } },
            include: { processType: { select: { code: true } }, product: { select: { name: true, sku: true } } }
        });
        console.log('\n=== NOTAS 260319 BATCHES ===');
        notes260319.forEach(n => console.log(n.productionBatch?.batchNumber || '?', n.processType?.code, n.product?.sku, n.product?.name?.slice(0, 30), '| status:', n.status, '| actual:', n.actualQuantity));
    }
}

main().catch(console.error).finally(() => p.$disconnect());
