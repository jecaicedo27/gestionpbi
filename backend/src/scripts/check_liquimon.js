const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const prods = await prisma.product.findMany({
        where: { sku: { startsWith: 'LIQUIMON' } },
        select: { sku: true, name: true, price: true, taxIncluded: true, taxes: true }
    });
    console.log(JSON.stringify(prods, null, 2));
}
main().finally(() => prisma.$disconnect());
