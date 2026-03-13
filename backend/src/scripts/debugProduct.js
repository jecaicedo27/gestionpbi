const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const product = await prisma.product.findFirst({
            where: {
                OR: [
                    { sku: 'GENG15' },
                    { barcode: 'GENG15' },
                    { name: { contains: 'GENIALITY ESCARCHADOR', mode: 'insensitive' } }
                ]
            },
            include: { group: true }
        });

        if (product) {
            console.log('--- Product Found in DB ---');
            console.log(`ID: ${product.id}`);
            console.log(`Name: ${product.name}`);
            console.log(`SKU: '${product.sku}'`);
            console.log(`Barcode: '${product.barcode}'`);
            console.log(`Group: '${product.group?.name}'`);
            console.log(`Daily Velocity: ${product.dailyVelocity}`);
            console.log(`Current Stock: ${product.currentStock}`);
        } else {
            console.log('❌ Product GENG15 / "GENIALITY ESCARCHADOR" NOT FOUND in DB');
        }

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
