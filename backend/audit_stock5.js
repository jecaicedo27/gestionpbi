const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const baseId = '6a492be8-34e2-41e1-8d09-9ac7f3dfeac7';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. ConsumptionHistory for BASE today
    const consumptions = await prisma.consumptionHistory.findMany({
        where: { productId: baseId, createdAt: { gte: today } },
        orderBy: { createdAt: 'asc' },
        select: { quantity: true, reference: true, createdAt: true, type: true }
    });
    console.log(`=== CONSUMPTION HISTORY TODAY for BASE SIROPE ===`);
    let totalCH = 0;
    const refMap = {};
    for (const c of consumptions) {
        totalCH += c.quantity;
        const ref = c.reference || '-';
        refMap[ref] = (refMap[ref] || 0) + 1;
        console.log(`${c.createdAt.toISOString().slice(11,19)} | ${(c.type || '').padEnd(20)} | qty: ${c.quantity}g | ref: ${ref.slice(0, 90)}`);
    }
    console.log(`\nTotal qty from ConsumptionHistory: ${totalCH}g (${(totalCH/1000).toFixed(1)}kg)`);
    console.log(`Number of records: ${consumptions.length}`);

    // 2. Duplicate references
    const dupes = Object.entries(refMap).filter(([_, count]) => count > 1);
    if (dupes.length > 0) {
        console.log(`\n=== DUPLICATE REFERENCES ===`);
        for (const [ref, count] of dupes) console.log(`  [${count}x] ${ref}`);
    }

    // 3. LotConsumption for BASE (use usedAt instead of createdAt)
    const lotConsumptions = await prisma.lotConsumption.findMany({
        where: { materialLot: { productId: baseId }, usedAt: { gte: today } },
        orderBy: { usedAt: 'asc' },
        include: { materialLot: { select: { lotNumber: true } } }
    });
    console.log(`\n=== LOT CONSUMPTIONS TODAY ===`);
    let totalLC = 0;
    for (const lc of lotConsumptions) {
        totalLC += lc.quantityUsed;
        console.log(`${lc.usedAt.toISOString().slice(11,19)} | qty: -${lc.quantityUsed}g | lot: ${lc.materialLot?.lotNumber} | note: ${lc.assemblyNoteId?.slice(0,8) || '-'}`);
    }
    console.log(`Total lot-consumed: ${totalLC}g (${(totalLC/1000).toFixed(1)}kg)`);
    console.log(`Number of lot consumptions: ${lotConsumptions.length}`);

    // 4. Assembly notes using BASE today
    const notesWithBase = await prisma.assemblyNoteItem.findMany({
        where: { componentId: baseId, assemblyNote: { startedAt: { gte: today } } },
        include: { assemblyNote: { select: { id: true, stageName: true, status: true, productionBatch: { select: { batchNumber: true } } } } }
    });
    console.log(`\n=== ASSEMBLY NOTES consuming BASE today ===`);
    let totalPlanned = 0, totalActual = 0;
    for (const ni of notesWithBase) {
        totalPlanned += ni.plannedQuantity || 0;
        totalActual += ni.actualQuantity || 0;
        console.log(`  ${(ni.assemblyNote?.productionBatch?.batchNumber || '').padEnd(30)} | ${(ni.assemblyNote?.stageName || '').padEnd(30)} | ${ni.assemblyNote?.status?.padEnd(10)} | planned: ${ni.plannedQuantity}g | actual: ${ni.actualQuantity || 0}g`);
    }
    console.log(`Total planned: ${totalPlanned}g (${(totalPlanned/1000).toFixed(1)}kg) | Total actual: ${totalActual}g`);

    // 5. MaterialLot state
    const lots = await prisma.materialLot.findMany({
        where: { productId: baseId },
        select: { lotNumber: true, currentQuantity: true, initialQuantity: true, zone: true, status: true }
    });
    console.log(`\n=== ALL MATERIAL LOTS for BASE SIROPE ===`);
    let totalLotStock = 0;
    for (const l of lots) {
        if (l.currentQuantity > 0) totalLotStock += l.currentQuantity;
        console.log(`  ${(l.lotNumber || '').padEnd(30)} | initial: ${l.initialQuantity}g | current: ${l.currentQuantity}g | zone: ${l.zone || '-'} | status: ${l.status}`);
    }
    console.log(`Total lot stock remaining: ${totalLotStock}g (${(totalLotStock/1000).toFixed(1)}kg)`);

    // 6. Product currentStock
    const product = await prisma.product.findUnique({ where: { id: baseId }, select: { currentStock: true } });
    console.log(`\nProduct.currentStock: ${product.currentStock}g (${(product.currentStock/1000).toFixed(1)}kg)`);
    console.log(`MISMATCH: product.currentStock (${product.currentStock}) vs lot total (${totalLotStock}) = diff ${product.currentStock - totalLotStock}g`);
}
main().finally(() => prisma.$disconnect());
