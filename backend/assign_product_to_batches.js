const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
    try {
        const liqd01 = await prisma.product.findFirst({ where: { sku: 'LIQD01' } });
        if (!liqd01) {
            console.log('Product LIQD01 not found');
            await prisma.$disconnect();
            return;
        }

        console.log(`Found LIQD01: ${liqd01.name} (ID: ${liqd01.id})`);

        const updated = await prisma.productionBatch.updateMany({
            where: {
                flavor: { contains: 'FRESA' },
                status: 'PENDING',
                productId: null
            },
            data: { productId: liqd01.id }
        });

        console.log(`✅ Updated ${updated.count} batches with productId LIQD01`);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
})();
