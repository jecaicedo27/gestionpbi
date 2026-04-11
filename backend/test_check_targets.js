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
            }
        }
    });

    for (const b of batches) {
        console.log(`\nBATCH: ${b.batchNumber}`);
        for (const t of b.outputTargets) {
            console.log(`  Target: ${t.product?.name} -> Planned: ${t.plannedUnits}, Actual: ${t.actualUnits}`);
        }
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
