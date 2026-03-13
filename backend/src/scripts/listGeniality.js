const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const products = await prisma.product.findMany({
            where: {
                group: { name: 'GENIALITY' }
            },
            select: { sku: true, name: true, active: true, dailyVelocity: true }
        });

        console.log(`--- Products in Group 'GENIALITY' (${products.length}) ---`);
        products.forEach(p => console.log(`[${p.sku}] ${p.name} (Active: ${p.active}, Velocity: ${p.dailyVelocity})`));

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
