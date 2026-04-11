const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batch = await prisma.productionBatch.findUnique({
        where: { batchNumber: 'COCO-260410-0800' },
        include: {
            outputTargets: true
        }
    });

    console.log(batch.outputTargets);
}
main().catch(console.error).finally(() => prisma.$disconnect());
