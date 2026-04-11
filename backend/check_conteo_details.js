const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batch = await prisma.productionBatch.findUnique({
        where: { batchNumber: 'COCO-260410-0800' },
        include: { assemblyNotes: { include: { completedBy: true, processType: true } } }
    });
    
    for (const note of batch.assemblyNotes) {
        console.log(`Note ${note.processType?.code}: completedAt=${note.completedAt}, user=${note.completedBy?.name} (role: ${note.completedBy?.role}), status=${note.status}`);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
