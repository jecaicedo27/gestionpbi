
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const searchTerm = 'ETIQUETA';
        const targetPackSize = 50;

        console.log(`\n🔍 Searching for products containing '${searchTerm}'...`);

        // Find count first just for logging
        const products = await prisma.product.findMany({
            where: {
                name: { contains: searchTerm, mode: 'insensitive' }
            },
            select: { name: true, packSize: true }
        });

        if (products.length === 0) {
            console.log(`   No products found.`);
            return;
        }

        console.log(`   Found ${products.length} products. Example: ${products[0].name} (Pack: ${products[0].packSize})`);

        // Update
        const result = await prisma.product.updateMany({
            where: {
                name: { contains: searchTerm, mode: 'insensitive' }
            },
            data: {
                packSize: targetPackSize
            }
        });

        console.log(`✅ Updated ${result.count} products to Pack Size = ${targetPackSize}.`);

    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
