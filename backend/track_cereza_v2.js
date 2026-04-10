const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function track() {
    const LOT = 'CEREZA-260407-0953';

    // 1. ProductionBatch que tenga ese batchNumber
    const batch = await prisma.productionBatch.findFirst({
        where: { batchNumber: LOT },
        select: { id: true, batchNumber: true, status: true, flavor: true }
    });
    console.log("=== ProductionBatch ===");
    console.log(batch ? JSON.stringify(batch) : "NO ENCONTRADO");

    // 2. AssemblyNotes del batch
    if (batch) {
        const notes = await prisma.assemblyNote.findMany({
            where: { productionBatchId: batch.id },
            select: {
                id: true, noteNumber: true, stageName: true, status: true, stageOrder: true,
                processType: { select: { code: true } },
                product: { select: { sku: true, name: true, accountGroup: true } },
                actualQuantity: true, targetQuantity: true
            },
            orderBy: { stageOrder: 'asc' }
        });
        console.log("\n=== AssemblyNotes del batch ===");
        notes.forEach(n => {
            const isPendingBlock = ['ENSAMBLE', 'ENSAMBLE_SIIGO'].includes(n.processType?.code) && n.status !== 'COMPLETED' && [1401, 1402].includes(n.product?.accountGroup);
            console.log(`  [${n.stageOrder}] ${n.processType?.code} | ${n.stageName} | Status: ${n.status} | ${n.product?.sku} | ${isPendingBlock ? '⚠️ BLOQUEANDO INGEST' : ''}`);
        });
    }

    // 3. FinishedLotStock de este lote
    const stocks = await prisma.finishedLotStock.findMany({
        where: { lotNumber: LOT },
        include: { product: { select: { sku: true, name: true } } }
    });
    console.log("\n=== FinishedLotStock CEREZA-260407-0953 ===");
    if (stocks.length === 0) console.log("  ⚠️ NINGUNO — el ingest nunca llegó a la DB");
    stocks.forEach(s => console.log(`  ${s.product?.sku} | [${s.zone}] | Ini: ${s.initialQuantity} | Actual: ${s.currentQuantity}`));

    // 4. Buscar en FinishedLotTransfer si hubo intento de ingest bloqueado
    const transfers = await prisma.finishedLotTransfer.findMany({
        where: { lotNumber: LOT },
        include: { product: { select: { sku: true } } },
        orderBy: { createdAt: 'desc' }
    });
    console.log("\n=== Transfers/Ingresos del lote ===");
    if (transfers.length === 0) console.log("  (ninguno)");
    transfers.forEach(t => console.log(`  ${t.product?.sku} | ${t.fromZone} -> ${t.toZone} | Qty: ${t.quantity} | ${t.reason} | ${t.createdAt.toISOString()}`));
}

track().catch(console.error).finally(() => prisma.$disconnect());
