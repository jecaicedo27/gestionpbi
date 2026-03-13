const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const products = await prisma.product.findMany({
            where: {
                group: { name: 'GENIALITY' }
            },
            select: { sku: true, name: true, type: true, dailyVelocity: true }
        });

        console.log(`--- Products in Group 'GENIALITY' Types ---`);
        products.forEach(p => console.log(`[${p.sku}] ${p.name} Type: ${p.type}`));

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
