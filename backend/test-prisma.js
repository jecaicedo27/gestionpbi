const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
    const products = await prisma.product.findMany({
        where: {
            active: true,
            group: {
                name: 'LIQUIPOPS'
            }
        },
        include: {
            group: true
        },
        take: 3
    });

    console.log('=== PRODUCTOS LIQUIPOPS ===');
    products.forEach(p => {
        console.log(`\nNombre: ${p.name}`);
        console.log(`Flavor: ${p.flavor}`);
        console.log(`Size: ${p.size}`);
        console.log(`---`);
    });

    await prisma.$disconnect();
}

test();
