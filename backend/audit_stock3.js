const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const baseId = '6a492be8-34e2-41e1-8d09-9ac7f3dfeac7';
    
    // Recent movements
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const movements = await prisma.movement.findMany({
        where: { productId: baseId, createdAt: { gte: today } },
        orderBy: { createdAt: 'asc' },
        select: { type: true, quantity: true, reference: true, createdAt: true }
    });

    console.log(`=== BASE SIROPE CLASICA — TODAY MOVEMENTS ===`);
    let sumIn = 0, sumOut = 0;
    for (const m of movements) {
        const q = m.quantity;
        if (q < 0) sumOut += Math.abs(q);
        else sumIn += q;
        console.log(`${m.createdAt.toISOString().slice(11,19)} | ${(m.type || '').padEnd(25)} | ${q >= 0 ? '+' : ''}${q}g | ${(m.reference || '-').slice(0, 80)}`);
    }
    console.log(`\nTOTAL: +${sumIn}g / -${sumOut}g = net ${sumIn - sumOut}g`);

    // LotConsumption for base
    const lotConsumptions = await prisma.lotConsumption.findMany({
        where: { materialLot: { productId: baseId }, createdAt: { gte: today } },
        orderBy: { createdAt: 'asc' },
        include: { materialLot: { select: { lotNumber: true } } },
        take: 30
    });
    console.log(`\n=== LOT CONSUMPTIONS TODAY ===`);
    let totalConsumed = 0;
    for (const lc of lotConsumptions) {
        totalConsumed += lc.quantity;
        console.log(`${lc.createdAt.toISOString().slice(11,19)} | qty: ${lc.quantity}g | lot: ${lc.materialLot?.lotNumber} | ref: ${(lc.reference || '-').slice(0, 60)}`);
    }
    console.log(`Total consumed via LotConsumption: ${totalConsumed}g (${(totalConsumed/1000).toFixed(1)}kg)`);

    // ConsumptionHistory for base
    const consumptions = await prisma.consumptionHistory.findMany({
        where: { productId: baseId, createdAt: { gte: today } },
        orderBy: { createdAt: 'asc' },
        take: 30,
        select: { quantity: true, reference: true, createdAt: true, type: true }
    });
    console.log(`\n=== CONSUMPTION HISTORY TODAY ===`);
    let totalCH = 0;
    for (const c of consumptions) {
        totalCH += c.quantity;
        console.log(`${c.createdAt.toISOString().slice(11,19)} | ${c.type || ''} | qty: ${c.quantity}g | ref: ${(c.reference || '-').slice(0, 60)}`);
    }
    console.log(`Total: ${totalCH}g`);

    // Check how many times BASE was consumed in assembly notes today
    const notesWithBase = await prisma.assemblyNoteItem.findMany({
        where: { componentId: baseId, assemblyNote: { startedAt: { gte: today } } },
        include: { assemblyNote: { select: { id: true, stageName: true, status: true, productionBatch: { select: { batchNumber: true } } } } }
    });
    console.log(`\n=== ASSEMBLY NOTES consuming BASE today ===`);
    for (const ni of notesWithBase) {
        console.log(`  Note: ${ni.assemblyNote?.productionBatch?.batchNumber} | ${ni.assemblyNote?.stageName} | status: ${ni.assemblyNote?.status} | planned: ${ni.plannedQuantity}g | actual: ${ni.actualQuantity}g`);
    }
}
main().finally(() => prisma.$disconnect());
