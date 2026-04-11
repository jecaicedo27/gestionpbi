const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const baseId = '6a492be8-34e2-41e1-8d09-9ac7f3dfeac7';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. LotConsumption for BASE today
    const lotConsumptions = await prisma.lotConsumption.findMany({
        where: { materialLot: { productId: baseId }, createdAt: { gte: today } },
        orderBy: { createdAt: 'asc' },
        include: { materialLot: { select: { lotNumber: true } } }
    });
    console.log(`=== LOT CONSUMPTIONS TODAY for BASE SIROPE ===`);
    let totalConsumed = 0;
    for (const lc of lotConsumptions) {
        totalConsumed += lc.quantity;
        console.log(`${lc.createdAt.toISOString().slice(11,19)} | qty: -${lc.quantity}g | lot: ${lc.materialLot?.lotNumber} | ref: ${(lc.reference || '-').slice(0, 80)}`);
    }
    console.log(`Total consumed via LotConsumption: ${totalConsumed}g (${(totalConsumed/1000).toFixed(1)}kg)`);

    // 2. ConsumptionHistory for BASE today
    const consumptions = await prisma.consumptionHistory.findMany({
        where: { productId: baseId, createdAt: { gte: today } },
        orderBy: { createdAt: 'asc' },
        select: { quantity: true, reference: true, createdAt: true, type: true }
    });
    console.log(`\n=== CONSUMPTION HISTORY TODAY ===`);
    let totalCH = 0;
    const refMap = {};
    for (const c of consumptions) {
        totalCH += c.quantity;
        const ref = c.reference || '-';
        refMap[ref] = (refMap[ref] || 0) + 1;
        console.log(`${c.createdAt.toISOString().slice(11,19)} | ${(c.type || '').padEnd(20)} | qty: ${c.quantity}g | ref: ${ref.slice(0, 70)}`);
    }
    console.log(`Total from ConsumptionHistory: ${totalCH}g (${(totalCH/1000).toFixed(1)}kg)`);

    // 3. Duplicate references
    console.log(`\n=== DUPLICATE REFERENCES ===`);
    for (const [ref, count] of Object.entries(refMap)) {
        if (count > 1) console.log(`  [${count}x] ${ref}`);
    }

    // 4. Assembly notes that consumed BASE today
    const notesWithBase = await prisma.assemblyNoteItem.findMany({
        where: { componentId: baseId, assemblyNote: { startedAt: { gte: today } } },
        include: { assemblyNote: { select: { id: true, stageName: true, status: true, productionBatch: { select: { batchNumber: true } } } } }
    });
    console.log(`\n=== ASSEMBLY NOTES consuming BASE today ===`);
    let totalAssemblyPlanned = 0;
    for (const ni of notesWithBase) {
        totalAssemblyPlanned += ni.plannedQuantity || 0;
        console.log(`  ${ni.assemblyNote?.productionBatch?.batchNumber} | ${ni.assemblyNote?.stageName} | status: ${ni.assemblyNote?.status} | planned: ${ni.plannedQuantity}g | actual: ${ni.actualQuantity || 0}g`);
    }
    console.log(`Total planned assembly usage: ${totalAssemblyPlanned}g (${(totalAssemblyPlanned/1000).toFixed(1)}kg)`);

    // 5. MaterialLot current state
    const lots = await prisma.materialLot.findMany({
        where: { productId: baseId },
        select: { lotNumber: true, currentQuantity: true, initialQuantity: true, zone: true, status: true }
    });
    console.log(`\n=== ALL MATERIAL LOTS for BASE SIROPE ===`);
    for (const l of lots) {
        const consumed = l.initialQuantity - l.currentQuantity;
        console.log(`  ${l.lotNumber} | initial: ${l.initialQuantity}g | current: ${l.currentQuantity}g | consumed: ${consumed}g | zone: ${l.zone} | status: ${l.status}`);
    }
}
main().finally(() => prisma.$disconnect());
