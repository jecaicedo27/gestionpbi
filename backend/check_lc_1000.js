const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const BATCH = 'MANGO-BICHE-260406-1621';
    const batch = await prisma.productionBatch.findFirst({ where: { batchNumber: BATCH }, select: { id: true } });

    const note1000 = await prisma.assemblyNote.findFirst({
        where: { productionBatchId: batch.id, processType: { code: 'EMPAQUE' }, product: { name: { contains: '1000' } } },
        select: { id: true, stageName: true }
    });
    console.log('Nota 1000 ML id:', note1000?.id);

    // All LotConsumptions for this note
    const lcs = await prisma.lotConsumption.findMany({
        where: { assemblyNoteId: note1000?.id },
        include: {
            materialLot: {
                include: { product: { select: { name: true } } }
            }
        }
    });
    console.log(`\nLotConsumptions en nota 1000ML: ${lcs.length}`);
    for (const lc of lcs) {
        console.log(`  - ${lc.materialLot?.product?.name || lc.materialLot?.siigoProductName}: ${lc.quantityUsed} | lotId=${lc.materialLotId} | lotNum=${lc.materialLot?.lotNumber}`);
    }

    // Check how traceability page queries - does it filter by lotNumber?
    // Look at how traceability works
    const allLcForBatch = await prisma.lotConsumption.findMany({
        where: { materialLot: { lotNumber: { contains: BATCH } } },
        include: { materialLot: { include: { product: { select: { name: true } } } } }
    });
    console.log(`\nLotConsumptions por lotNumber=${BATCH}: ${allLcForBatch.length}`);
    for (const lc of allLcForBatch) {
        console.log(`  - ${lc.materialLot?.product?.name}: ${lc.quantityUsed}`);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
