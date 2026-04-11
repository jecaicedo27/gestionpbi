const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const batches = await prisma.productionBatch.findMany({
        where: {
            batchNumber: { in: ['MARACUYA-260410-1623', 'SANDIA-260408-1410'] }
        }
    });
    for(const b of batches) {
        console.log(b.batchNumber, '->', b.status);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
