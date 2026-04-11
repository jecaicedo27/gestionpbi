const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    console.log(await prisma.productionBatch.findMany({
        where: { batchNumber: { in: ['TAMARINDO-260410-0645', 'ESCARCHADOR-260409-0428'] } },
        select: { batchNumber: true, status: true }
    }));
}
main().finally(() => prisma.$disconnect());
