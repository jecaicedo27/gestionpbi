const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const products = await prisma.product.findMany({
        where: { dailyVelocity: { gt: 0 } },
        take: 10,
        select: { sku: true, name: true, dailyVelocity: true, currentStock: true }
    });
    console.log('Products with dailyVelocity > 0:', JSON.stringify(products, null, 2));

    const totalProducts = await prisma.product.count();
    const zeroVelocityProducts = await prisma.product.count({ where: { dailyVelocity: 0 } });
    const nullVelocityProducts = await prisma.product.count({ where: { dailyVelocity: { equals: null } } });

    console.log(`Total Products: ${totalProducts}`);
    console.log(`Zero Velocity: ${zeroVelocityProducts}`);
    console.log(`Null Velocity: ${nullVelocityProducts}`);

    const totalMovements = await prisma.movement.count();
    console.log(`Total Movements: ${totalMovements}`);

    const vtaMovements = await prisma.movement.count({ where: { type: 'VTA' } });
    console.log(`VTA Movements: ${vtaMovements}`);

    const consMovements = await prisma.movement.count({ where: { type: 'CONS' } });
    console.log(`CONS Movements: ${consMovements}`);

    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - 90);
    const recentVta = await prisma.movement.count({ where: { type: 'VTA', date: { gte: rangeStart } } });
    console.log(`VTA Movements (last 90d): ${recentVta}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
