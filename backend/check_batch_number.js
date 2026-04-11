const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const lot = 'TAMARINDO-260410-0645';
    
    const batch = await prisma.productionBatch.findUnique({
        where: { batchNumber: lot },
        include: {
            assemblyNotes: {
                include: { product: true }
            }
        }
    });

    if (!batch) {
        console.log("No batch found by batchNumber.");
        const similar = await prisma.productionBatch.findMany({
            where: { batchNumber: { contains: 'TAMARINDO' } },
            orderBy: { createdAt: 'desc' },
            take: 3
        });
        console.log("Did you mean one of these?", similar.map(s => s.batchNumber));
        return;
    }

    console.log(`Found batch: ${batch.batchNumber} (${batch.id})`);

    for (const note of batch.assemblyNotes) {
        console.log(`\n--- Note ${note.id} ---`);
        console.log(`Product: ${note.product?.name} (Step: ${note.currentStage})`);
        if (note.customData) console.log("customData", JSON.stringify(note.customData, null, 2));
        if (note.customFields) console.log("customFields", JSON.stringify(note.customFields, null, 2));
    }
}
main().finally(() => prisma.$disconnect());
