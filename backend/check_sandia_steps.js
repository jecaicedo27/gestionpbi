const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const lotS = 'SANDIA-260408-1410';
    const batch = await prisma.productionBatch.findUnique({where: {batchNumber: lotS}});
    const notes = await prisma.assemblyNote.findMany({ 
        where: { productionBatchId: batch.id },
        orderBy: { stageOrder: 'asc' },
        include: { processType: true }
    });
    for(const n of notes) {
        console.log(`[Stage ${n.stageOrder}] ${n.stageName} -> status: ${n.status}, type: ${n.processType?.code}`);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
