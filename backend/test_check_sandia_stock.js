const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const s1000 = await prisma.product.findFirst({ where: { name: 'SIROPE GENIALITY SABOR A SANDIA X 1000 ML' } });
    if (s1000) {
        const stocks = await prisma.finishedLotStock.findMany({ where: { productId: s1000.id } });
        console.log('SANDIA 1000 ML Stocks:', stocks);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
