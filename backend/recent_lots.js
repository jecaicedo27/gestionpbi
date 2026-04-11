const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const lots = await prisma.finishedLotStock.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 10,
        include: { product: { select: { name: true } } }
    });
    lots.forEach(l => console.log(l.lotNumber, '|', l.product.name, '|', l.currentQuantity));
}
main().finally(() => prisma.$disconnect());
