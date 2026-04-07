const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const batch = await p.productionBatch.findFirst({ where: { batchNumber: 'CHAMOY-260326-0151' } });
    
    // ENSAMBLE notes
    const ensambles = await p.assemblyNote.findMany({
        where: { productionBatchId: batch.id, processType: { code: 'ENSAMBLE' } },
        select: { id: true, stageName: true, targetQuantity: true, actualQuantity: true, status: true }
    });
    console.log('=== ENSAMBLE NOTES ===');
    ensambles.forEach(n => console.log(n.stageName, '| target:', n.targetQuantity, '| actual:', n.actualQuantity, '| status:', n.status));

    // FinishedLotStock for CHAMOY-260326-0151
    const stocks = await p.finishedLotStock.findMany({
        where: { lotNumber: 'CHAMOY-260326-0151' },
        include: { product: { select: { name: true } } }
    });
    console.log('\n=== FinishedLotStock ===');
    if (stocks.length === 0) console.log('NINGUNO');
    stocks.forEach(s => console.log(s.zone, '|', s.product?.name, '| qty:', s.currentQuantity));
}

main().catch(console.error).finally(() => p.$disconnect());
