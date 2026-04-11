const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const baseId = '6a492be8-34e2-41e1-8d09-9ac7f3dfeac7';
    const today = new Date(); today.setHours(0,0,0,0);

    // 1. ALL lots created today for BASE SIROPE
    const lotsToday = await prisma.materialLot.findMany({
        where: { productId: baseId, receivedAt: { gte: today } },
        orderBy: { receivedAt: 'asc' }
    });
    console.log(`=== LOTS CREATED TODAY for BASE SIROPE (${lotsToday.length}) ===`);
    for (const l of lotsToday) {
        console.log(`  ${l.lotNumber.padEnd(40)} | init: ${l.initialQuantity}g (${(l.initialQuantity/1000).toFixed(1)}kg) | curr: ${l.currentQuantity}g | at: ${l.receivedAt.toISOString().slice(11,19)}`);
    }

    // 2. ALL assembly notes for BASE SIROPE today
    const allNotes = await prisma.assemblyNote.findMany({
        where: { productId: baseId, startedAt: { gte: today } },
        include: { productionBatch: { select: { batchNumber: true } }, processType: true },
        orderBy: { stageOrder: 'asc' }
    });
    console.log(`\n=== ALL NOTES for BASE SIROPE today (${allNotes.length}) ===`);
    for (const n of allNotes) {
        console.log(`  ${(n.productionBatch?.batchNumber || '').padEnd(30)} | ${(n.processType?.code || '').padEnd(12)} | ${(n.stageName || '').slice(0,40).padEnd(40)} | target: ${n.targetQuantity}g (${(n.targetQuantity/1000).toFixed(1)}kg) → actual: ${n.actualQuantity||0}g (${((n.actualQuantity||0)/1000).toFixed(1)}kg) | ${n.status}`);
    }

    // 3. Recent ENSAMBLE notes for BASE (last 7 days)
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
    const recentEnsamble = await prisma.assemblyNote.findMany({
        where: { productId: baseId, processType: { code: 'ENSAMBLE' }, completedAt: { gte: weekAgo } },
        include: { productionBatch: { select: { batchNumber: true } } },
        orderBy: { completedAt: 'desc' }
    });
    console.log(`\n=== RECENT ENSAMBLE for BASE SIROPE (last 7 days: ${recentEnsamble.length}) ===`);
    for (const n of recentEnsamble) {
        console.log(`  ${(n.productionBatch?.batchNumber || '').padEnd(30)} | target: ${n.targetQuantity}g (${(n.targetQuantity/1000).toFixed(1)}kg) → actual: ${n.actualQuantity||0}g (${((n.actualQuantity||0)/1000).toFixed(1)}kg) | at: ${n.completedAt?.toISOString().slice(0,16)} | ${n.status}`);
    }
}
main().finally(() => prisma.$disconnect());
