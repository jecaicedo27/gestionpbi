const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const batch = await prisma.productionBatch.findUnique({
        where: { batchNumber: 'TAMARINDO-260410-0645' },
        include: { assemblyNotes: true }
    });
    console.log("Batch:", batch.id);
    for (const n of batch.assemblyNotes) {
        console.log(n.id, n.stageName, n.status, n.actualLotNumber || n.lotNumber || 'No lot recorded');
    }
}
main().finally(() => prisma.$disconnect());
