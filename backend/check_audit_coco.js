const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batch = await prisma.productionBatch.findUnique({
        where: { batchNumber: 'COCO-260410-0800' }
    });

    const logs = await prisma.auditLog.findMany({
        where: {
            entity: 'ProductionBatch',
            entityId: batch.id
        },
        orderBy: { createdAt: 'asc' }
    });

    console.log(logs);
}
main().catch(console.error).finally(() => prisma.$disconnect());
