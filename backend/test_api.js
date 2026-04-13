const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const p = await prisma.product.findFirst({ where: { sku: 'GENG15' } });
    console.log("Product from DB:", JSON.stringify(p, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
