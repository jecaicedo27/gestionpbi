const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const products = await prisma.product.findMany({
        where: {
            OR: [
                { name: { contains: 'TARRO LIQUIPOPS 1150' } },
                { name: { contains: 'TAPA LIQUIPOPS 1150' } },
                { name: { contains: 'LINER' } }
            ]
        },
        select: { id: true, name: true, productionZoneStock: true, currentStock: true }
    });
    
    console.log("Matching Packaging Products:");
    console.table(products);
}

main().catch(console.error).finally(() => prisma.$disconnect());
