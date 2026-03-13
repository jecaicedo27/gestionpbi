
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const product = await prisma.product.findFirst({
            where: {
                name: { contains: 'DIOXIDO', mode: 'insensitive' }
            }
        });

        if (product) {
            console.log(`Product: ${product.name}`);
            console.log(`ID: ${product.id}`);
            console.log(`Pack Size (DB): ${product.packSize}`);
            console.log(`Min Stock (DB): ${product.minimumStock}`);
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
