const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batches = await prisma.productionBatch.findMany({
        where: {
            batchNumber: { in: ['MARACUYA-260410-1623', 'SANDIA-260409-1450'] }
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
        console.log(`\nBATCH: ${b.batchNumber} - Status: ${b.status} - CurrentStage: ${b.currentStage}`);
        for (const t of b.outputTargets) {
            console.log(`  Target: ${t.product?.name} -> Planned: ${t.plannedUnits}, Weight: ${t.plannedWeightKg}`);
        }
        for (const n of b.assemblyNotes) {
            if (n.status !== 'COMPLETED') {
                console.log(`  [${n.status}] ${n.stageOrder}: ${n.stageName} (TargetQty: ${n.targetQuantity} ${n.unit})`);
            }
        }
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
