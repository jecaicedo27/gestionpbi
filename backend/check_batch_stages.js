const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const batches = await prisma.productionBatch.findMany({
        where: {
            batchNumber: { in: ['SANDIA-260408-1410', 'TAMARINDO-260410-0645', 'MARACUYA-260410-1623'] }
        },
        include: {
            assemblyNotes: {
                orderBy: { stageOrder: 'asc' }
            },
            outputTargets: true
        }
    });

    for (const b of batches) {
        console.log(`\nBatch ${b.batchNumber} - TARGETS: ${b.outputTargets.map(t => t.plannedUnits).join(', ')}`);
        let i = 1;
        for (const n of b.assemblyNotes) {
            console.log(`  ${i++}. [${n.status}] ${n.stageName} (ID: ${n.id.slice(0,8)}) - Product: ${n.productId}`);
        }
    }
}
main().finally(() => prisma.$disconnect());
