const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const sugar = await prisma.product.findFirst({ where: { name: { contains: 'AZUCAR', mode: 'insensitive' } } });
    console.log("SIIGO STOCK (from DB snapshot): " + sugar.currentStock + " gramos");

    const mlots = await prisma.materialLot.aggregate({
        where: { productId: sugar.id, currentQuantity: { gt: 0 } },
        _sum: { currentQuantity: true }
    });
    console.log("APP LOCAL STOCK: " + mlots._sum.currentQuantity + " gramos");
}
main().catch(console.error).finally(() => prisma.$disconnect());
