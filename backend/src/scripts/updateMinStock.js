
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        console.log('🚀 Starting Statistical Minimum Stock Calculation...');

        // 1. Fetch all Raw Materials
        const products = await prisma.product.findMany({
            where: {
                classification: 'MATERIA_PRIMA',
                active: true
            }
        });

        console.log(`📦 Found ${products.length} Raw Materials.`);

        let updated = 0;
        let skipped = 0;

        for (const p of products) {
            const velocity = p.dailyVelocity || 0;

            if (velocity > 0) {
                // Formula: Velocity * 15 days
                const newMinStock = Math.ceil(velocity * 15);

                await prisma.product.update({
                    where: { id: p.id },
                    data: {
                        minimumStock: newMinStock
                    }
                });
                console.log(`✅ Updated ${p.name}: Velocity ${velocity.toFixed(2)} -> MinStock ${newMinStock}`);
                updated++;
            } else {
                skipped++;
            }
        }

        console.log(`🏁 Complete. Updated: ${updated}, Skipped (Zero Velocity): ${skipped}`);

    } catch (error) {
        console.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
