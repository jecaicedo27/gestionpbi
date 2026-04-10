const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batch = await prisma.productionBatch.findFirst({
        where: { batchNumber: 'MANGO-BICHE-260406-1621' },
    });
    const note = await prisma.assemblyNote.findFirst({
        where: { 
            productionBatchId: batch.id,
            processType: { code: 'EMPAQUE' },
            product: { name: { contains: '1000 ML' } }
        }
    });
    console.log(note.processParameters);
}

main().catch(console.error).finally(() => prisma.$disconnect());
