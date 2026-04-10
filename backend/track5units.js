const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function track() {
    // 1. Stock en zona de PRODUCCION (no transferido a bodega aun)
    const zoneStock = await prisma.finishedLotStock.findMany({
        where: {
            currentQuantity: { gt: 0 },
            zone: 'PRODUCCION'
        },
        include: { product: { select: { name: true, sku: true } } },
        orderBy: { createdAt: 'desc' }
    });
    
    console.log("=== Stock en ZONA PRODUCCION (no transferido a Bodega) ===");
    zoneStock.forEach(s => {
        console.log(`  SKU: ${s.product?.sku} | ${s.product?.name?.substring(0,40)} | Qty: ${s.currentQuantity} | Lote: ${s.lotNumber} | Status: ${s.status}`);
    });
    console.log(`  TOTAL registros en zona produccion: ${zoneStock.length}`);

    // 2. Actas pendientes de recepcion
    const pendingHandoffs = await prisma.productHandoff.findMany({
        where: { status: 'PENDING' },
        include: {
            items: { include: { product: { select: { name: true, sku: true } } } }
        },
        orderBy: { createdAt: 'desc' }
    });

    console.log("\n=== Actas PENDIENTES (enviadas pero no recibidas en bodega) ===");
    if (pendingHandoffs.length === 0) {
        console.log("  Ninguna acta pendiente.");
    }
    pendingHandoffs.forEach(h => {
        console.log(`  Acta: ${h.actaNumber} | ${h.createdAt}`);
        h.items.forEach(i => {
            console.log(`    - ${i.product?.sku} | Qty: ${i.quantity}`);
        });
    });

    // 3. Resumen de stock en BODEGA CENTRAL
    const bodegaStock = await prisma.finishedLotStock.groupBy({
        by: ['productId'],
        where: { zone: 'BODEGA_CENTRAL' },
        _sum: { currentQuantity: true },
    });
    console.log(`\n=== Stock en BODEGA_CENTRAL (${bodegaStock.length} referencias) ===`);
    const productIds = bodegaStock.map(b => b.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true } });
    bodegaStock.forEach(b => {
        const p = products.find(x => x.id === b.productId);
        console.log(`  ${p?.sku} | ${p?.name?.substring(0,35)} | Total Qty: ${b._sum.currentQuantity}`);
    });
}

track().catch(console.error).finally(() => prisma.$disconnect());
