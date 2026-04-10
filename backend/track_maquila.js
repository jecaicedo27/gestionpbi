const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function track() {
    // LIQA08 = Chicle 3400GR
    const product = await prisma.product.findFirst({
        where: { sku: 'LIQA08' },
        select: { id: true, sku: true, name: true }
    });
    console.log(`Producto: ${product?.sku} | ${product?.name}`);

    // Todo el stock en MAQUILA independientemente del producto
    const maquilaAll = await prisma.finishedLotStock.findMany({
        where: { zone: 'MAQUILA' },
        include: { product: { select: { sku: true, name: true } } },
        orderBy: { createdAt: 'desc' }
    });

    console.log("\n=== Todo el stock en zona MAQUILA ===");
    if (maquilaAll.length === 0) console.log("  (No hay registros en zona MAQUILA)");
    maquilaAll.forEach(s => {
        console.log(`  ${s.product?.sku} | ${s.product?.name?.substring(0,40)} | Lote: ${s.lotNumber} | Ini: ${s.initialQuantity} | Actual: ${s.currentQuantity} | Status: ${s.status}`);
    });

    // Buscar LIQA08 en TODAS las zonas incluyendo MAQUILA y depleted
    if (product) {
        const allStocks = await prisma.finishedLotStock.findMany({
            where: { productId: product.id },
            orderBy: { createdAt: 'desc' }
        });
        console.log("\n=== LIQA08 en TODAS las zonas (incluyendo agotados) ===");
        allStocks.forEach(s => {
            console.log(`  [${s.zone}] Lote: ${s.lotNumber} | Ini: ${s.initialQuantity} | Actual: ${s.currentQuantity} | Status: ${s.status} | Creado: ${s.createdAt.toISOString().substring(0,10)}`);
        });

        // Transferencias de LIQA08
        const transfers = await prisma.finishedLotTransfer.findMany({
            where: { stock: { productId: product.id } },
            include: { stock: { select: { lotNumber: true } } },
            orderBy: { createdAt: 'desc' },
            take: 20
        });
        console.log("\n=== Transferencias/Movimientos LIQA08 ===");
        if (transfers.length === 0) console.log("  (ninguno)");
        transfers.forEach(t => {
            console.log(`  Lote: ${t.stock?.lotNumber} | Qty: ${t.quantity} | ${t.fromZone} -> ${t.toZone} | Motivo: ${t.reason} | ${t.createdAt.toISOString().substring(0,10)}`);
        });
    }
}

track().catch(console.error).finally(() => prisma.$disconnect());
