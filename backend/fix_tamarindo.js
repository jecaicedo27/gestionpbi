const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const batches = await prisma.productionBatch.findMany({
        where: { flavor: 'TAMARINDO', batchNumber: 'TAMARINDO-260410-0645' },
        include: { assemblyNotes: true, outputTargets: true }
    });

    for (const b of batches) {
        const allowed = b.outputTargets.map(t => t.productId);
        const invalid = b.assemblyNotes.filter(n => {
            const isEmpaqueOrEnsamble = n.processTypeId === 3 || n.processTypeId === 5 || n.stageName?.includes('Empaque') || n.stageName?.includes('Ensamble');
            const noteProductId = n.processParameters?.product_id || n.productId;
            return isEmpaqueOrEnsamble && !allowed.includes(noteProductId);
        });

        console.log(`Deleting ${invalid.length} notes from ${b.batchNumber}`);
        for (const n of invalid) {
            await prisma.assemblyNoteItem.deleteMany({ where: { assemblyNoteId: n.id } });
            await prisma.assemblyNote.delete({ where: { id: n.id } });
            console.log(` Deleted ${n.stageName}`);
        }
    }
}
main().finally(() => prisma.$disconnect());
