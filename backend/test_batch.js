const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const batch = await prisma.productionBatch.findFirst({
        where: { batchNumber: '1110' },
        include: { outputTargets: { include: { product: true } } }
    });
    if (!batch) {
        console.log("Batch not found");
        process.exit(0);
    }
    console.log("BATCH:", batch.batchNumber, batch.status, batch.currentStage);
    console.log("Targets:");
    batch.outputTargets.forEach(t => console.log(t.product?.name, t.plannedUnits));
    
    const notes = await prisma.assemblyNote.findMany({
        where: { productionBatchId: batch.id },
        include: { processType: true },
        orderBy: { order: 'asc' }
    });
    console.log("NOTES:");
    notes.forEach(n => console.log(n.processType?.name, n.status, n.stageName, n.order, n.productOutLabel));
    process.exit(0);
}
run();
