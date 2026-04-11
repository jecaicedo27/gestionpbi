const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batches = await prisma.productionBatch.findMany({
        where: {
            batchNumber: 'COCO-260410-8000'
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
            console.log(`[${note.processType?.code}] Note ID: ${note.id}`);
            if (note.processParameters) {
                if (note.processParameters.conteo) {
                     console.log(`   conteo:`, JSON.stringify(note.processParameters.conteo, null, 2));
                }
                if (note.processParameters.conteo_draft) {
                     console.log(`   conteo_draft:`, JSON.stringify(note.processParameters.conteo_draft, null, 2));
                }
                 if (note.processParameters.carriots) {
                     console.log(`   carriots:`, JSON.stringify(note.processParameters.carriots, null, 2));
                }
            }
        }
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
