const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batch = await prisma.productionBatch.findUnique({
        where: { batchNumber: 'COCO-260410-0800' },
        include: { outputTargets: true }
    });

    console.log(`Batch created:`, batch.scheduledStart); // this is when scheduler created it
    console.log(`Batch started (quickStart):`, batch.startedAt); // this is when quickStart ran
    
    for (const t of batch.outputTargets) {
        console.log(`Target ${t.productId}: planned=${t.plannedUnits}, created=${t.createdAt}, updated=${t.updatedAt}`);
    }

}
main().catch(console.error).finally(() => prisma.$disconnect());
