const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const baseId = '6a492be8-34e2-41e1-8d09-9ac7f3dfeac7';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. ConsumptionHistory for BASE today
    const consumptions = await prisma.consumptionHistory.findMany({
        where: { productId: baseId, date: { gte: today } },
        orderBy: { date: 'asc' }
    });
    console.log(`=== CONSUMPTION HISTORY TODAY for BASE SIROPE (${consumptions.length} records) ===`);
    let totalConsumed = 0;
    const refMap = {};
    for (const c of consumptions) {
        totalConsumed += c.consumed;
        const ref = c.source + '|' + (c.reference || '-');
        refMap[ref] = (refMap[ref] || 0) + 1;
        console.log(`${c.date.toISOString().slice(11,19)} | ${(c.source || '').padEnd(20)} | consumed: ${c.consumed}g | ref: ${(c.reference || '-').slice(0, 80)}`);
    }
    console.log(`\nTotal consumed today: ${totalConsumed}g (${(totalConsumed/1000).toFixed(1)}kg)`);

    // 2. Duplicate references
    const dupes = Object.entries(refMap).filter(([_, count]) => count > 1);
    if (dupes.length > 0) {
        console.log(`\n=== DUPLICATE REFERENCES ===`);
        for (const [ref, count] of dupes) console.log(`  [${count}x] ${ref}`);
    }

    // 3. LotConsumption for BASE today  
    const lotConsumptions = await prisma.lotConsumption.findMany({
        where: { materialLot: { productId: baseId }, usedAt: { gte: today } },
        orderBy: { usedAt: 'asc' },
        include: { materialLot: { select: { lotNumber: true } } }
    });
    console.log(`\n=== LOT CONSUMPTIONS TODAY (${lotConsumptions.length} records) ===`);
    let totalLC = 0;
    for (const lc of lotConsumptions) {
        totalLC += lc.quantityUsed;
        console.log(`${lc.usedAt.toISOString().slice(11,19)} | qty: -${lc.quantityUsed}g | lot: ${lc.materialLot?.lotNumber?.slice(0,25)} | note: ${lc.assemblyNoteId?.slice(0,8) || '-'}`);
    }
    console.log(`Total lot-consumed: ${totalLC}g (${(totalLC/1000).toFixed(1)}kg)`);

    // 4. Assembly notes using BASE today
    const notesWithBase = await prisma.assemblyNoteItem.findMany({
        where: { componentId: baseId, assemblyNote: { startedAt: { gte: today } } },
        include: { assemblyNote: { select: { id: true, stageName: true, status: true, productionBatch: { select: { batchNumber: true } } } } }
    });
    console.log(`\n=== ASSEMBLY NOTES consuming BASE today (${notesWithBase.length}) ===`);
    let tp = 0, ta = 0;
    for (const ni of notesWithBase) {
        tp += ni.plannedQuantity || 0;
        ta += ni.actualQuantity || 0;
        console.log(`  ${(ni.assemblyNote?.productionBatch?.batchNumber || '').padEnd(28)} | ${(ni.assemblyNote?.stageName || '').slice(0,25).padEnd(25)} | ${(ni.assemblyNote?.status || '').padEnd(10)} | plan: ${ni.plannedQuantity}g | actual: ${ni.actualQuantity || 0}g`);
    }
    console.log(`Planned: ${tp}g (${(tp/1000).toFixed(1)}kg) | Actual: ${ta}g (${(ta/1000).toFixed(1)}kg)`);

    // 5. MaterialLot state
    const lots = await prisma.materialLot.findMany({
        where: { productId: baseId },
        select: { lotNumber: true, currentQuantity: true, initialQuantity: true, zone: true, status: true }
    });
    console.log(`\n=== ALL MATERIAL LOTS for BASE SIROPE ===`);
    let totalLotStock = 0;
    for (const l of lots) {
        totalLotStock += l.currentQuantity;
        console.log(`  ${(l.lotNumber || '').padEnd(28)} | init: ${l.initialQuantity}g | curr: ${l.currentQuantity}g | zone: ${l.zone || '-'} | ${l.status}`);
    }
    console.log(`Total lot stock: ${totalLotStock}g (${(totalLotStock/1000).toFixed(1)}kg)`);

    const prod = await prisma.product.findUnique({ where: { id: baseId }, select: { currentStock: true } });
    console.log(`Product.currentStock: ${prod.currentStock}g (${(prod.currentStock/1000).toFixed(1)}kg)`);
    console.log(`\n⚠ MISMATCH: product.currentStock=${prod.currentStock} vs lot total=${totalLotStock} → diff=${prod.currentStock - totalLotStock}g`);
}
main().finally(() => prisma.$disconnect());
