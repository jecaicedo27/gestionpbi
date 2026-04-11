const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batches = await prisma.productionBatch.findMany({
        where: {
            batchNumber: { in: ['MARACUYA-260410-1623', 'SANDIA-260408-1410'] }
        },
        include: {
            outputTargets: {
                include: { product: true }
            },
            assemblyNotes: {
                orderBy: { stageOrder: 'asc' }
            }
        }
    });

    for (const b of batches) {
        console.log(`\nBATCH: ${b.batchNumber} - Status: ${b.status}`);
        for (const n of b.assemblyNotes) {
            console.log(`  [${n.status}] ${n.stageOrder}: ${n.stageName} (Target: ${n.targetQuantity}, Actual: ${n.actualQuantity})`);
        }
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
