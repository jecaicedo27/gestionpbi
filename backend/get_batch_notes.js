const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const batches = await prisma.productionBatch.findMany({
        where: { batchNumber: { contains: 'TAMARINDO' } },
        include: {
            assemblyNotes: {
                include: { processType: true, product: true }
            }
        }
    });
    for (const batch of batches) {
        console.log("\nBatch:", batch.batchNumber);
        for (const n of batch.assemblyNotes) {
            console.log(`  Note ${n.id} | ${n.processType.code} | ${n.status} | Product: ${n.product?.name}`);
        }
    }
}
main().finally(() => prisma.$disconnect());
