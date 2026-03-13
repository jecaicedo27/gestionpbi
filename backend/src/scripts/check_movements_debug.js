const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const totalProducts = await prisma.product.count();
    console.log(`Total Products: ${totalProducts}`);

    const totalMovements = await prisma.movement.count();
    console.log(`Total Movements: ${totalMovements}`);

    const vtaMovements = await prisma.movement.count({ where: { type: 'VTA' } });
    console.log(`VTA Movements (Total): ${vtaMovements}`);

    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - 90);
    const recentVta = await prisma.movement.count({ where: { type: 'VTA', date: { gte: rangeStart } } });
    console.log(`VTA Movements (Last 90d): ${recentVta}`);

    const consMovements = await prisma.movement.count({ where: { type: 'CONS' } });
    console.log(`CONS Movements (Total): ${consMovements}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
