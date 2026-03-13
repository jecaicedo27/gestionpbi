const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkBatches() {
    try {
        const batches = await prisma.productionBatch.findMany({
            orderBy: { id: 'desc' },
            take: 10
        });

        console.log('--- LATEST 10 BATCHES ---');
        batches.forEach(b => {
            console.log(`[${b.id}] ${b.batchNumber} - ${b.flavor}`);
            console.log(`    baseWeight: ${b.baseWeight} (Type: ${typeof b.baseWeight})`);
            console.log(`    projectedTotalWeight: ${b.projectedTotalWeight}`);
            console.log('-------------------------');
        });

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkBatches();
