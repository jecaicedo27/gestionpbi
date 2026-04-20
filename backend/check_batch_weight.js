const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const batch = await prisma.productionBatch.findFirst({
        where: { flavor: 'MARACUYA' },
        orderBy: { createdAt: 'desc' }
    });
    console.log(batch);
}
check().catch(console.error).finally(() => prisma.$disconnect());
