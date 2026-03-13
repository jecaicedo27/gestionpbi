const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function deleteAllBatches() {
    try {
        console.log('Starting batch deletion...');

        // Delete all production batches (cascade will handle output targets)
        const result = await prisma.productionBatch.deleteMany({});

        console.log(`✓ Successfully deleted ${result.count} production batches`);

    } catch (error) {
        console.error('❌ Error deleting batches:', error.message);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

deleteAllBatches()
    .then(() => {
        console.log('Batch deletion completed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Failed to delete batches:', error);
        process.exit(1);
    });
