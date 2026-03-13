
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const product = await prisma.product.findFirst({
            where: {
                AND: [
                    { name: { contains: 'CAFE', mode: 'insensitive' } },
                    { name: { contains: '360', mode: 'insensitive' } },
                    { name: { contains: 'SIROPE', mode: 'insensitive' } }
                ]
            }
        });

        if (product) {
            console.log(`Product: ${product.name} (${product.sku})`);
            console.log(`Daily Velocity: ${product.dailyVelocity}`);
            console.log(`Current Stock: ${product.currentStock}`);
            console.log(`Days of Stock: ${product.daysOfStock}`);
            console.log(`Pack Size: ${product.packSize}`);
        } else {
            console.log('Product not found.');
        }

    } catch (error) {
        console.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
