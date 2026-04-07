const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    // Find all pending/executing ENSAMBLE notes with CHAMOY in stage name
    const notes = await p.assemblyNote.findMany({
        where: {
            status: { in: ['PENDING', 'EXECUTING'] },
            processType: { code: 'ENSAMBLE' },
            stageName: { contains: 'CHAMOY' }
        },
        include: { productionBatch: { select: { batchNumber: true } } }
    });

    if (notes.length === 0) {
        console.log('No active CHAMOY ENSAMBLE notes. Checking CHAMOY-260326-0328...');
        const batch = await p.productionBatch.findFirst({ where: { batchNumber: 'CHAMOY-260326-0328' } });
        if (batch) {
            const all = await p.assemblyNote.findMany({
                where: { productionBatchId: batch.id, processType: { code: 'ENSAMBLE' } },
                include: { productionBatch: { select: { batchNumber: true } } }
            });
            all.forEach(n => console.log(n.productionBatch?.batchNumber, '|', n.stageName, '| qty:', n.targetQuantity, '| status:', n.status, '| id:', n.id));
        }
        return;
    }

    notes.forEach(n => console.log(n.productionBatch?.batchNumber, '|', n.stageName, '| qty:', n.targetQuantity, '| status:', n.status, '| id:', n.id));

    // Update 1150g one to 134
    const target = notes.find(n => n.stageName.includes('1150'));
    if (target) {
        await p.assemblyNote.update({ where: { id: target.id }, data: { targetQuantity: 134 } });
        console.log(`✅ Updated ${target.stageName} → 134 tarros`);
    }
}

main().catch(console.error).finally(() => p.$disconnect());
