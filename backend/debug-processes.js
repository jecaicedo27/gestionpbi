
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const products = await prisma.product.findMany({
        where: {
            OR: [
                { name: { contains: 'PROCESO', mode: 'insensitive' } },
                { classification: 'PRODUCTO_EN_PROCESO' }
            ]
        },
        select: {
            siigoId: true,
            name: true,
            classification: true
        },
        take: 50
    });

    const processTypes = await prisma.processType.findMany();

    console.log('--- PRODUCTS (PROCESO / EN PROCESO) ---');
    console.table(products);

    console.log('--- PROCESS TYPES ---');
    console.table(processTypes);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
