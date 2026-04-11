const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batches = await prisma.productionBatch.findMany({
        where: {
            batchNumber: { in: ['MARACUYA-260410-1623', 'SANDIA-260408-1410'] }
        },
        include: {
            assemblyNotes: {
                where: { stageName: { contains: 'Conteo' } }
            }
        }
    });

    for (const b of batches) {
        console.log(`\nBATCH: ${b.batchNumber}`);
        for (const n of b.assemblyNotes) {
            console.log(`Conteo Blob:`, JSON.stringify(n.processParameters?.conteo, null, 2));
        }
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
