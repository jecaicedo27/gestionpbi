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
                where: {
                    processType: {
                        code: 'CONTEO'
                    }
                }
            }
        }
    });

    for (const b of batches) {
        console.log(`\n=================== BATCH: ${b.batchNumber} ===================`);
        for (const note of b.assemblyNotes) {
            console.log(`[CONTEO Note ID: ${note.id}] status: ${note.status}`);
            if (note.processParameters) {
                console.log(`   conteo:`, note.processParameters.conteo);
                console.log(`   conteo_draft:`, note.processParameters.conteo_draft);
            }
        }
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
