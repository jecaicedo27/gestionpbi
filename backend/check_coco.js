const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batches = await prisma.productionBatch.findMany({
        where: {
            batchNumber: {
                startsWith: 'COCO-260410'
            }
        },
        include: {
            assemblyNotes: {
                include: {
                    processType: true
                }
            }
        }
    });

    for (const b of batches) {
        console.log(`\n=================== BATCH: ${b.batchNumber} ===================`);
        for (const note of b.assemblyNotes) {
            console.log(`Note [${note.processType?.code}]:`);
            console.log(`   quantities:`, JSON.stringify(note.quantities));
            if (note.processParameters) {
                if (note.processParameters.empaque || note.processParameters.conteo_qty || note.processParameters.carriots) {
                     console.log(`   processParameters (relevant keys): `, Object.keys(note.processParameters).filter(k => ['empaque','conteo_qty','carriots'].includes(k)));
                }
            }
        }
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
