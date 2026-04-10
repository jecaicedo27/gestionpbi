const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const products = await prisma.product.findMany({
        where: {
            OR: [
                { name: 'TARRO LIQUIPOPS 1150 GR - 1000ML' },
                { name: 'TAPA LIQUIPOPS 1150 GR - 1000ML' },
                { name: 'LINER TAPA LIQUIPOPS 1150 GR - 1000ML' }
            ]
        }
    });

    for (const p of products) {
        if (p.productionZoneStock < 86) {
           const diff = 86 - p.productionZoneStock;
           await prisma.product.update({
               where: { id: p.id },
               data: {
                   productionZoneStock: 86,
                   currentStock: { decrement: diff }
               }
           });
           console.log(`Updated ${p.name} to 86.`);
        } else {
           console.log(`${p.name} is already at ${p.productionZoneStock}.`);
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
