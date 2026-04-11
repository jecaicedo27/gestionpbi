const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const batches = await prisma.productionBatch.findMany({
        where: {
            flavor: { in: ['SANDIA', 'MARACUYA', 'MARACUYÁ'] }
        },
        include: {
            assemblyNotes: {
                orderBy: { stageOrder: 'asc' }
            },
            outputTargets: true
        }
    });

    const activeBatches = batches.filter(b => b.status === 'PENDING' || b.status === 'IN_PROGRESS' || b.status === 'EXECUTING' || b.status === 'STAGE_1_BASE' || b.status === 'PRODUCING');
    console.log(`Found ${activeBatches.length} active batches`);

    for (const b of activeBatches) {
        console.log(`Batch ${b.batchNumber} - ${b.flavor}`);

        // What output target did this batch ACTUALLY have?
        const allowedProductIds = b.outputTargets.map(t => t.productId);
        console.log(`  Allowed Products: ${allowedProductIds.join(', ')}`);

        // Find notes that are EMPAQUE or ENSAMBLE but their productId is NOT in allowedProductIds
        const invalidNotes = b.assemblyNotes.filter(n => {
            const isEmpaqueOrEnsamble = n.processTypeId === 3 || n.processTypeId === 5 || n.stageName?.includes('Empaque') || n.stageName?.includes('Ensamble');
            const noteProductId = n.processParameters?.product_id || n.productId;
            
            if (isEmpaqueOrEnsamble && !allowedProductIds.includes(noteProductId)) {
                return true;
            }
            return false;
        });

        console.log(`  Found ${invalidNotes.length} invalid duplicate notes`);
        for (const n of invalidNotes) {
            console.log(`    - Note ${n.stageName} (ID: ${n.id}) - status: ${n.status}`);
            // Let's delete it
            await prisma.assemblyNoteItem.deleteMany({ where: { assemblyNoteId: n.id } });
            await prisma.assemblyNote.delete({ where: { id: n.id } });
            console.log(`      -> DELETED`);
        }
    }
}
main().finally(() => prisma.$disconnect());
