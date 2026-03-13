
const { PrismaClient } = require('@prisma/client');
const siigoService = require('../services/siigoService');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

async function run() {
    try {
        console.log('🚀 Triggering Full Sync to update classifications...');
        await siigoService.syncAllProducts();
        console.log('✅ Sync Completed.');

        // Verify Sample
        const count = await prisma.product.count({
            where: { classification: { not: null } }
        });
        console.log(`📦 Products with classification: ${count}`);

        const sample = await prisma.product.findFirst({
            where: { classification: 'PRODUCTO_TERMINADO' }
        });
        console.log('Sample Finished Product:', sample?.name);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

run();
