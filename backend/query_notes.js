const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batchId = "441c5f30-a53d-492f-9212-3505be9afddc"; // The batch from the RPA error
    const notes = await prisma.assemblyNote.findMany({
        where: { productionBatchId: batchId },
        select: { stageName: true, productId: true, actualQuantity: true, processType: { select: { code: true } } },
        orderBy: { stageOrder: 'asc' }
    });
    console.log(JSON.stringify(notes, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
