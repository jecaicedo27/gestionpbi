const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function wipe() {
    console.log("Wiping ALL Pending (Ghost) Batches...");

    // Fetch all pending
    const res = await prisma.productionBatch.deleteMany({
        where: { status: 'PENDING' }
    });

    console.log(`Deleted ${res.count} pending batches. Calendar should be empty now.`);
}

wipe();
