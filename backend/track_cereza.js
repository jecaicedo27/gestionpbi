const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function track() {
    // Buscar actas de ensamble de cereza recientes (completadas)
    const notes = await prisma.assemblyNote.findMany({
        where: {
            flavor: { contains: 'CEREZA', mode: 'insensitive' },
            createdAt: { gte: new Date('2026-04-07') }
        },
        select: {
            id: true, noteNumber: true, status: true, flavor: true,
            totalUnits: true, completedAt: true, createdAt: true,
            batches: {
                select: {
                    id: true, batchCode: true, status: true,
                    plannedUnits: true, actualUnits: true,
                    productId: true
                }
            }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
    });

    console.log("=== Actas de Ensamble CEREZA (desde ayer) ===");
    notes.forEach(n => {
        console.log(`\nActa: ${n.noteNumber} | Status: ${n.status} | Completada: ${n.completedAt}`);
        n.batches.forEach(b => {
            console.log(`  Batch: ${b.batchCode} | Status: ${b.status} | Planned: ${b.plannedUnits} | Actual: ${b.actualUnits}`);
        });
    });

    // Buscar FinishedLotStock de cereza creados hoy
    const todayStocks = await prisma.finishedLotStock.findMany({
        where: {
            lotNumber: { contains: 'CEREZA', mode: 'insensitive' },
            createdAt: { gte: new Date('2026-04-08') }
        },
        include: { product: { select: { sku: true, name: true } } },
        orderBy: { createdAt: 'desc' }
    });
    
    console.log("\n=== FinishedLotStock CEREZA creados HOY ===");
    if (todayStocks.length === 0) console.log("  (Ninguno - esto es el problema!)");
    todayStocks.forEach(s => {
        console.log(`  ${s.product?.sku} | Lote: ${s.lotNumber} | Zona: ${s.zone} | Ini: ${s.initialQuantity} | Actual: ${s.currentQuantity}`);
    });

    // ProductionBatch de Cereza con status reciente
    const batches = await prisma.productionBatch.findMany({
        where: {
            flavor: { contains: 'CEREZA', mode: 'insensitive' },
            createdAt: { gte: new Date('2026-04-07') }
        },
        select: { id: true, batchCode: true, status: true, flavor: true, targetTotalKg: true, createdAt: true, completedAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5
    });
    
    console.log("\n=== ProductionBatch CEREZA (desde ayer) ===");
    if (batches.length === 0) console.log("  (Ninguno)");
    batches.forEach(b => {
        console.log(`  ${b.batchCode} | Status: ${b.status} | Completado: ${b.completedAt}`);
    });
}

track().catch(console.error).finally(() => prisma.$disconnect());
