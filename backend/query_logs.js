const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Find all ENSAMBLE notes for Geniality products in today's batches
    const ensambleNotes = await prisma.assemblyNote.findMany({
        where: {
            processType: { code: 'ENSAMBLE' },
            product: { accountGroup: 1402 },  // Geniality accountGroup
            status: 'COMPLETED'
        },
        select: {
            id: true,
            stageName: true,
            productId: true,
            processParameters: true,
            productionBatch: { select: { batchNumber: true } }
        },
        orderBy: { completedAt: 'desc' },
        take: 10
    });
    console.log(JSON.stringify(ensambleNotes.map(n => ({
        id: n.id,
        stage: n.stageName,
        batch: n.productionBatch?.batchNumber,
        hasCarritos: !!(n.processParameters?.carriots)
    })), null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
