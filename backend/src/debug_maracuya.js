const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const products = await prisma.product.findMany({
        where: {
            flavor: { contains: 'MARACUYA', mode: 'insensitive' },
            group: { name: 'LIQUIPOPS' },
            classification: 'PRODUCTO_TERMINADO'
        }
    });

    console.log("Maracuya Products:");
    products.forEach(p => {
        console.log(`SKU: ${p.sku}, Name: ${p.name}, Stock: ${p.currentStock}, Velocity(DB): ${p.dailyVelocity}`);
    });
}

main();
