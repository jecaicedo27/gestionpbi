const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkProduct() {
    console.log("--- Checking Exact SKU: GENI16 ---");
    const exactMatch = await prisma.product.findFirst({
        where: {
            OR: [
                { sku: 'GENI16' },
                { barcode: 'GENI16' }
            ]
        }
    });

    if (exactMatch) {
        console.log('✅ Exact Match Found:', {
            id: exactMatch.id,
            name: exactMatch.name,
            sku: exactMatch.sku,
            dailyVelocity: exactMatch.dailyVelocity
        });
    } else {
        console.log('❌ No product found with SKU/Barcode "GENI16"');
    }

    console.log("\n--- Searching by Name: LIQUIPOPS + FRESA + 350 ---");
    const nameMatches = await prisma.product.findMany({
        where: {
            AND: [
                { name: { contains: 'LIQUIPOPS' } },
                { name: { contains: 'FRESA' } },
                { name: { contains: '350' } }
            ]
        }
    });

    nameMatches.forEach(p => {
        console.log(`Found: [${p.sku}] ${p.name} - Velocity: ${p.dailyVelocity}`);
    });

    await prisma.$disconnect();
}

checkProduct();
