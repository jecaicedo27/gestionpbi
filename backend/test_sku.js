const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const p = await prisma.product.findFirst({ where: { OR: [{ sku: 'GENG15' }, { barcode: '7709168134024' }] }});
    console.log("Product:", p ? p.name : "NOT FOUND");
}
main().catch(console.error).finally(() => prisma.$disconnect());
