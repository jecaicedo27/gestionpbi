const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Find ALL products with desynchronized stock
    const allProducts = await prisma.product.findMany({
        select: { id: true, name: true, currentStock: true }
    });

    let fixed = 0;
    const fixes = [];

    for (const prod of allProducts) {
        const lots = await prisma.materialLot.findMany({
            where: { productId: prod.id, currentQuantity: { gt: 0 } },
            select: { currentQuantity: true }
        });
        const realStock = lots.reduce((sum, l) => sum + l.currentQuantity, 0);

        // Check for significant mismatch (more than 1kg off, or negative stock)
        const diff = prod.currentStock - realStock;
        if (prod.currentStock < 0 || Math.abs(diff) > 1000) {
            fixes.push({
                name: prod.name,
                id: prod.id,
                was: prod.currentStock,
                shouldBe: realStock,
                diff
            });
        }
    }

    console.log(`=== PRODUCTS WITH DESYNCHRONIZED STOCK (${fixes.length}) ===`);
    for (const f of fixes) {
        console.log(`  ${f.name.slice(0,40).padEnd(40)} | was: ${f.was}g | real: ${f.shouldBe}g | diff: ${f.diff}g`);
    }

    // Apply fixes
    for (const f of fixes) {
        await prisma.product.update({
            where: { id: f.id },
            data: { currentStock: f.shouldBe }
        });
        fixed++;
    }
    console.log(`\n✅ Fixed ${fixed} products`);

    // Verify BASE SIROPE specifically
    const base = await prisma.product.findFirst({
        where: { name: { contains: 'BASE SIROPE CLASICA', mode: 'insensitive' } },
        select: { name: true, currentStock: true }
    });
    console.log(`\nBASE SIROPE CLASICA → currentStock: ${base.currentStock}g (${(base.currentStock/1000).toFixed(1)}kg)`);

    const color = await prisma.product.findFirst({
        where: { name: { contains: 'COLOR EN POLVO AMARILLO LIMON', mode: 'insensitive' } },
        select: { name: true, currentStock: true }
    });
    console.log(`COLOR AMARILLO → currentStock: ${color.currentStock}g`);
}
main().finally(() => prisma.$disconnect());
