const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batchId = "441c5f30-a53d-492f-9212-3505be9afddc";
    const notes = await prisma.assemblyNote.findMany({
        where: { productionBatchId: batchId },
        select: { id: true, stageName: true, productId: true, targetQuantity: true, processType: { select: { code: true } } },
        orderBy: { stageOrder: 'asc' }
    });
    console.log(JSON.stringify(notes.filter(n => n.processType.code === 'ENSAMBLE'), null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
