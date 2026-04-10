const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function track() {
    // ProductionBatch de Cereza Geniality recientes
    const batches = await prisma.productionBatch.findMany({
        where: {
            flavor: { contains: 'CEREZA', mode: 'insensitive' },
            createdAt: { gte: new Date('2026-04-07') }
        },
        select: { id: true, batchCode: true, status: true, flavor: true, targetTotalKg: true, createdAt: true, completedAt: true, line: true },
        orderBy: { createdAt: 'desc' },
        take: 10
    });
    
    console.log("=== ProductionBatch CEREZA (desde ayer) ===");
    batches.forEach(b => {
        console.log(`  ${b.batchCode} | Line: ${b.line} | Status: ${b.status} | Completado: ${b.completedAt}`);
    });

    // Buscar GENI02 (Sirope Geniality Cereza 1000ml) en todas las zonas
    const geniProducts = await prisma.product.findMany({
        where: { sku: { in: ['GENI02', 'GENI14'] } }, // 1000ml y 360ml Cereza
        select: { id: true, sku: true, name: true }
    });
    console.log("\n=== Productos Geniality Cereza ===");
    geniProducts.forEach(p => console.log(`  ${p.sku} | ${p.name}`));

    for (const prod of geniProducts) {
        const stocks = await prisma.finishedLotStock.findMany({
            where: { productId: prod.id },
            orderBy: { createdAt: 'desc' },
            take: 10
        });
        console.log(`\n  Stock ${prod.sku}:`);
        if (stocks.length === 0) console.log("    (ninguno)");
        stocks.forEach(s => {
            console.log(`    [${s.zone}] Lote: ${s.lotNumber} | Ini: ${s.initialQuantity} | Actual: ${s.currentQuantity} | Status: ${s.status} | Fecha: ${s.createdAt.toISOString().substring(0,10)}`);
        });
    }

    // Revisar el lote CEREZA-260407-0953 en particular
    console.log("\n=== Buscando lote CEREZA-260407-0953 ===");
    const lotStock = await prisma.finishedLotStock.findMany({
        where: { lotNumber: { contains: 'CEREZA-260407-0953' } },
        include: { product: { select: { sku: true, name: true } } }
    });
    if (lotStock.length === 0) {
        console.log("  ⚠️  NO existe en FinishedLotStock — el stock no se inyectó al completar");
    } else {
        lotStock.forEach(s => console.log(`  ${s.product?.sku} | [${s.zone}] Ini: ${s.initialQuantity} | Actual: ${s.currentQuantity}`));
    }
}

track().catch(console.error).finally(() => prisma.$disconnect());
