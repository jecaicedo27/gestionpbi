const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const lot = await prisma.materialLot.findFirst({ include: { product: { include: { group: true } } } });
    console.log(lot.product.group.name);
}
main().catch(console.error).finally(() => prisma.$disconnect());
