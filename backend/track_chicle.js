const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function track() {
    // Buscar todos los productos de Chicle
    const chicleProducts = await prisma.product.findMany({
        where: { name: { contains: 'CHICLE', mode: 'insensitive' } },
        select: { id: true, sku: true, name: true }
    });
    
    console.log("=== Productos CHICLE ===");
    chicleProducts.forEach(p => console.log(`  ${p.sku} | ${p.name}`));
    
    const productIds = chicleProducts.map(p => p.id);
    
    // Todo el stock en todas las zonas
    const stocks = await prisma.finishedLotStock.findMany({
        where: { productId: { in: productIds } },
        include: { product: { select: { sku: true, name: true } } },
        orderBy: [{ zone: 'asc' }, { createdAt: 'desc' }]
    });
    
    console.log("\n=== Stock CHICLE por zona ===");
    stocks.forEach(s => {
        console.log(`  [${s.zone}] ${s.product?.sku} | Lote: ${s.lotNumber} | Ini: ${s.initialQuantity} | Actual: ${s.currentQuantity} | Status: ${s.status}`);
    });
    
    // Resumen por zona
    const byZone = {};
    stocks.forEach(s => {
        if (!byZone[s.zone]) byZone[s.zone] = 0;
        byZone[s.zone] += s.currentQuantity;
    });
    
    console.log("\n=== Resumen CHICLE por zona ===");
    Object.entries(byZone).forEach(([zone, qty]) => {
        console.log(`  ${zone}: ${qty} uds`);
    });
}

track().catch(console.error).finally(() => prisma.$disconnect());
