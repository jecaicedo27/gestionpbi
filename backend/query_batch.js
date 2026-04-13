const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const notes = await prisma.assemblyNote.findMany({
        where: { productionBatchId: '441c5f30-a53d-492f-9212-3505be9afddc' },
        include: {
            processType: { select: { code: true } }
        },
        orderBy: { stageOrder: 'asc' }
    });
    
    console.log(JSON.stringify(notes.map(n => ({
        id: n.id,
        stage: n.stageName,
        process: n.processType?.code,
        targetQty: n.targetQuantity,
        actualQty: n.actualQuantity,
        unit: n.unit
    })), null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
