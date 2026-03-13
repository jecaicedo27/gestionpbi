const { PrismaClient } = require('@prisma/client');
const siigoService = require('../services/siigoService');
const logger = require('../utils/logger');

const prisma = new PrismaClient();

async function reprocessProducts() {
    try {
        console.log('Fetching all products...');
        const products = await prisma.product.findMany({});
        console.log(`Found ${products.length} products to check.`);

        let updatedCount = 0;

        for (const product of products) {
            const flavor = siigoService.extractFlavor(product.name);
            const size = siigoService.extractSize(product.name);

            // Only update if something changed
            if (product.flavor !== flavor || product.size !== size) {
                await prisma.product.update({
                    where: { id: product.id },
                    data: { flavor, size }
                });
                updatedCount++;
                if (updatedCount % 50 === 0) process.stdout.write('.');
            }
        }

        console.log(`\n✅ Reprocessed complete. Updated ${updatedCount} products.`);
    } catch (error) {
        console.error('Error reprocessing:', error);
    } finally {
        await prisma.$disconnect();
    }
}

reprocessProducts();
