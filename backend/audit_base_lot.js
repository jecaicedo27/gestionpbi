const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const baseId = '6a492be8-34e2-41e1-8d09-9ac7f3dfeac7';
    
    // Find ALL lots created today for BASE SIROPE
    const today = new Date(); today.setHours(0,0,0,0);
    const lotsToday = await prisma.materialLot.findMany({
        where: { productId: baseId, receivedAt: { gte: today } },
        orderBy: { receivedAt: 'asc' }
    });
    console.log(`=== LOTS CREATED TODAY for BASE SIROPE (${lotsToday.length}) ===`);
    for (const l of lotsToday) {
        console.log(`  ${l.lotNumber.padEnd(35)} | init: ${l.initialQuantity}g (${(l.initialQuantity/1000).toFixed(1)}kg) | curr: ${l.currentQuantity}g | zone: ${l.zone} | status: ${l.status} | at: ${l.receivedAt.toISOString().slice(11,19)}`);
    }

    // Find the assembly notes (ENSAMBLE) that produced BASE SIROPE today
    const ensambleNotes = await prisma.assemblyNote.findMany({
        where: {
            productId: baseId,
            processType: { code: 'ENSAMBLE' },
            completedAt: { gte: today }
        },
        include: {
            productionBatch: { select: { batchNumber: true } },
            processType: true
        },
        orderBy: { completedAt: 'asc' }
    });
    console.log(`\n=== ENSAMBLE NOTES that produced BASE SIROPE today (${ensambleNotes.length}) ===`);
    for (const n of ensambleNotes) {
        console.log(`  ${(n.productionBatch?.batchNumber || '').padEnd(35)} | target: ${n.targetQuantity}g (${(n.targetQuantity/1000).toFixed(1)}kg) | actual: ${n.actualQuantity}g (${((n.actualQuantity||0)/1000).toFixed(1)}kg) | status: ${n.status} | at: ${n.completedAt?.toISOString().slice(11,19)}`);
    }

    // Now check ALL assembly notes for BASE today (any process type)
    const allNotes = await prisma.assemblyNote.findMany({
        where: {
            productId: baseId,
            startedAt: { gte: today }
        },
        include: {
            productionBatch: { select: { batchNumber: true } },
            processType: true
        },
        orderBy: { stageOrder: 'asc' }
    });
    console.log(`\n=== ALL NOTES for BASE SIROPE today (${allNotes.length}) ===`);
    for (const n of allNotes) {
        console.log(`  ${(n.productionBatch?.batchNumber || '').padEnd(30)} | ${(n.processType?.code || '').padEnd(12)} | ${n.stageName?.slice(0,35).padEnd(35)} | target: ${n.targetQuantity}g | actual: ${n.actualQuantity||0}g | status: ${n.status}`);
    }

    // Check the specific batch that should have produced 700kg
    // Look for recent BASE SIROPE batches
    const batches = await prisma.productionBatch.findMany({
        where: {
            notes: { some: { productId: baseId } },
            createdAt: { gte: today }
        },
        select: {
            id: true,
            batchNumber: true,
            status: true,
            notes: {
                where: { productId: baseId },
                select: {
                    stageName: true,
                    targetQuantity: true,
                    actualQuantity: true,
                    status: true,
                    processType: { select: { code: true } }
                },
                orderBy: { stageOrder: 'asc' }
            }
        }
    });
    console.log(`\n=== BATCHES producing BASE SIROPE today ===`);
    for (const b of batches) {
        console.log(`\n  BATCH: ${b.batchNumber} (${b.status})`);
        for (const n of b.notes) {
            console.log(`    ${(n.processType?.code || '').padEnd(12)} | ${n.stageName?.slice(0,40).padEnd(40)} | target: ${n.targetQuantity}g → actual: ${n.actualQuantity || 0}g | ${n.status}`);
        }
    }
}
main().finally(() => prisma.$disconnect());
