const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const rpa = await prisma.rpaExecution.findMany({
        take: 3,
        orderBy: { startedAt: 'desc' },
        include: {
            assemblyNote: {
                include: { product: true, productionBatch: true }
            }
        }
    });

    console.log(JSON.stringify(rpa, null, 2));
}

check().catch(console.error).finally(()=> prisma.$disconnect());
