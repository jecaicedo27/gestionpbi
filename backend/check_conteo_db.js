const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batch = await prisma.productionBatch.findUnique({
        where: { batchNumber: 'COCO-260410-0800' },
        include: { assemblyNotes: { where: { processType: { code: 'CONTEO' } } } }
    });
    
    console.log(JSON.stringify(batch.assemblyNotes[0].processParameters, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
