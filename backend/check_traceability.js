const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const BATCH = 'MANGO-BICHE-260406-1621';
    const batch = await prisma.productionBatch.findFirst({ where: { batchNumber: BATCH }, select: { id: true } });

    // Check what LotConsumption records exist for this batch's EMPAQUE notes
    const empaqueNotes = await prisma.assemblyNote.findMany({
        where: { productionBatchId: batch.id, processType: { code: 'EMPAQUE' } },
        select: { id: true, stageName: true }
    });

    console.log(`EMPAQUE notes: ${empaqueNotes.map(n => n.stageName).join(', ')}`);

    for (const note of empaqueNotes) {
        const lotConsumptions = await prisma.lotConsumption.findMany({
            where: { assemblyNoteId: note.id },
            include: { materialLot: { include: { product: { select: { name: true } } } } }
        });
        console.log(`\n${note.stageName}: ${lotConsumptions.length} LotConsumption records`);
        for (const lc of lotConsumptions) {
            console.log(`  → ${lc.materialLot?.product?.name}: ${lc.quantityUsed}`);
        }
    }

    // Check audit logs for EMPAQUE_CARRITO_CONSUMED
    const auditLogs = await prisma.auditLog.findMany({
        where: { action: { in: ['CONSUMPTION_ALERT', 'EMPAQUE_CARRITO_CONSUMED'] }, entity: 'AssemblyNote' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { action: true, entityId: true, changes: true, createdAt: true }
    });
    console.log(`\nAudit logs recientes:`);
    for (const log of auditLogs) {
        console.log(`  [${log.action}] ${log.entityId} - ${JSON.stringify(log.changes).slice(0, 120)}`);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
