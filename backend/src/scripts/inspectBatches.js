const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspect() {
    const batches = await prisma.productionBatch.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 50
    });

    console.log(`Found ${batches.length} PENDING batches.`);

    // Group by flavor and start time to see duplicates
    const groups = {};
    batches.forEach(b => {
        const key = `${b.flavor}_${b.scheduledStart.toISOString()}`;
        if (!groups[key]) groups[key] = 0;
        groups[key]++;
    });

    console.log("Potential Duplicates (Flavor_Time): Count");
    console.table(groups);
}

inspect();
