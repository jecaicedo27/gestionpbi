const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const p = await prisma.product.findFirst({ where: { name: { contains: 'LINER TAPA LIQUIPOPS 1150' } }});
    if (p && p.productionZoneStock < 86) {
        const diff = 86 - p.productionZoneStock;
        await prisma.product.update({
            where: { id: p.id },
            data: { productionZoneStock: 86, currentStock: { decrement: diff } }
        });
        console.log(`Updated LINER to 86`);
    } else if (p) {
        console.log(`LINER ${p.name} already at ${p.productionZoneStock}`);
    } else {
        console.log('Liner not found by contains limit!');
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
