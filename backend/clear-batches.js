const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function deleteAllBatches() {
    try {
        const deletedTargets = await prisma.outputTarget.deleteMany({
            where: { batchId: { not: null } }
        });
        console.log(`Deleted ${deletedTargets.count} output targets`);

        const deletedBatches = await prisma.productionBatch.deleteMany({});
        console.log(`Deleted ${deletedBatches.count} production batches`);

        console.log('All batches cleared successfully!');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

deleteAllBatches();
