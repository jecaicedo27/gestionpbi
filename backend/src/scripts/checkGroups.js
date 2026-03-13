const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const groups = await prisma.inventoryGroup.findMany();
        console.log('--- Inventory Groups ---');
        groups.forEach(g => console.log(`[${g.siigoId}] ${g.name} (${g.type})`));

        const products = await prisma.product.findMany({
            take: 10,
            include: { group: true }
        });
        console.log('\n--- Sample Products & Groups ---');
        products.forEach(p => console.log(`${p.name} -> Group: ${p.group?.name}`));

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
