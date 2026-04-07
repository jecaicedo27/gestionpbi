const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const prods = await prisma.product.findMany({
        where: { sku: { in: ['GENI03', 'GENG15', 'GENP15', 'GENI07'] } },
        select: { sku: true, name: true, price: true, taxIncluded: true, taxes: true }
    });
    console.log(JSON.stringify(prods, null, 2));
}
main().finally(() => prisma.$disconnect());
