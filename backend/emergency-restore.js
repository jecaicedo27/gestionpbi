const siigoService = require('./src/services/siigoService');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function restore() {
    console.log('🚀 Starting emergency restoration...');

    try {
        // 1. Sync Products from SIIGO
        console.log('📡 Syncing products from SIIGO...');
        const result = await siigoService.syncAllProducts();
        console.log('✅ Products restored:', result);

        // 2. Report status
        const productCount = await prisma.product.count();
        console.log(`📊 Current Products in DB: ${productCount}`);

    } catch (error) {
        console.error('❌ Restoration failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

restore();
