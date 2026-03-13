const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
    try {
        const batch = await prisma.productionBatch.findUnique({
            where: { id: '6af395ae-e9b3-441e-8b67-fd0393b0e39a' },
            include: {
                product: {
                    include: {
                        templates: { where: { isActive: true } }
                    }
                }
            }
        });

        if (!batch) {
            console.log('❌ Batch not found with that ID');
        } else {
            console.log('Batch:', batch.batchNumber);
            console.log('ProductId:', batch.productId);
            console.log('Product:', batch.product?.name || 'NULL');
            console.log('Templates:', batch.product?.templates?.length || 0);

            if (batch.product?.templates?.[0]) {
                console.log('Template ID:', batch.product.templates[0].id);
                console.log('Template Name:', batch.product.templates[0].templateName);
            }
        }
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await prisma.$disconnect();
    }
})();
