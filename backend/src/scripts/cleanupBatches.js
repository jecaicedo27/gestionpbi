const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanup() {
    console.log("Starting cleanup of duplicate chunks...");

    // Fetch all pending
    const batches = await prisma.productionBatch.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' } // Newest first
    });

    const seen = new Set();
    const toDelete = [];

    for (const b of batches) {
        // Key based on matching scheduling
        const key = `${b.flavor}_${b.scheduledStart.toISOString()}`;

        if (seen.has(key)) {
            // Already seen a newer one, so this is a duplicate -> delete
            toDelete.push(b.id);
        } else {
            // This is the first (newest) one we see, keep it
            seen.add(key);
        }
    }

    console.log(`Found ${toDelete.length} duplicates to delete.`);

    if (toDelete.length > 0) {
        const res = await prisma.productionBatch.deleteMany({
            where: {
                id: { in: toDelete }
            }
        });
        console.log(`Deleted ${res.count} batches.`);
    }
}

cleanup();
