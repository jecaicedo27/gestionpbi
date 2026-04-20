const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clean() {
    const batches = await prisma.productionBatch.findMany({
        where: { batchNumber: { startsWith: 'MARACUYA-260413' } }
    });
    for (const batch of batches) {
        await prisma.assemblyNoteItem.deleteMany({ where: { note: { productionBatchId: batch.id } } });
        await prisma.assemblyProcessVariable.deleteMany({ where: { assemblyNote: { productionBatchId: batch.id } } });
        await prisma.assemblyNote.deleteMany({ where: { productionBatchId: batch.id } });
        await prisma.batchOutputTarget.deleteMany({ where: { batchId: batch.id } });
        await prisma.productionBatch.delete({ where: { id: batch.id } });
        console.log(`Cleaned ${batch.batchNumber}`);
    }
}
clean().catch(console.error).finally(() => prisma.$disconnect());
