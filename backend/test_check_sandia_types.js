const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const lotS = 'SANDIA-260408-1410';
    const notes = await prisma.assemblyNote.findMany({ 
        where: { productionBatchId: (await prisma.productionBatch.findUnique({where:{batchNumber: lotS}})).id },
        include: { processType: true }
    });
    for(const n of notes) {
        console.log(`[Stage ${n.stageOrder}] ${n.stageName} -> type: ${n.processType?.code}, producesOutput: ${n.processType?.producesOutput}`);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
