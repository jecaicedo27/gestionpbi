const { PrismaClient } = require('@prisma/client');
const siigoService = require('../services/siigoService');
const prisma = new PrismaClient();

async function debugAzucar() {
    try {
        console.log('🔍 Searching for product "AZUCAR" (MP2F01)...');

        const product = await prisma.product.findFirst({
            where: {
                OR: [
                    { sku: 'MP2F01' },
                    { name: 'AZUCAR' }
                ]
            },
            include: {
                inventoryAlternate: true
            }
        });

        if (!product) {
            console.log('❌ Product not found in local DB');
            return;
        }

        console.log('\n📅 LOCAL DB STATE (Before Sync):');
        console.log(`CurrentStock: ${product.currentStock}`);

        console.log('\n☁️ SIIGO API STATE:');
        try {
            await siigoService.authenticate();

            // Check Pagination first
            const page1 = await siigoService.getProducts(1, 50);
            console.log(`\n📄 Pagination Info:`);
            console.log(`Total Pages: ${page1.pagination.total_pages}`);
            console.log(`Total Products: ${page1.pagination.total_results || 'Unknown'}`);

            const siigoProduct = await siigoService.getProduct(product.siigoId);

            console.log(`Siigo Available Quantity: ${siigoProduct.available_quantity}`);

            // FORCE SYNC
            console.log('\n🔄 FORCING SYNC...');
            await siigoService.syncProduct(siigoProduct);
            console.log('✅ Sync executed.');

            // Verify
            const updatedProduct = await prisma.product.findUnique({ where: { id: product.id } });
            console.log(`\n📅 LOCAL DB STATE (After Sync):`);
            console.log(`CurrentStock: ${updatedProduct.currentStock}`);

        } catch (err) {
            console.error('Error fetching from Siigo:', err.response?.data || err.message);
        }

    } catch (error) {
        console.error('Error in debug script:', error);
    } finally {
        await prisma.$disconnect();
    }
}

debugAzucar();
