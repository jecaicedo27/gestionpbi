const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const handoffService = require('../src/services/handoffService');

async function main() {
    const user = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
    if (!user) throw new Error("No admin found");

    const pending = await prisma.productHandoff.findMany({
        where: { status: 'PENDING' },
        include: { items: true }
    });
    const inPending = {};
    pending.forEach(h => h.items.forEach(i => {
        const key = i.productId + '_' + i.lotNumber;
        inPending[key] = (inPending[key] || 0) + i.requestedQuantity;
    }));

    const lots = await prisma.finishedLotStock.findMany({
        where: { zone: 'PRODUCCION', currentQuantity: { gt: 0 } },
        include: { product: true }
    });

    const itemsToHandOff = [];
    for (const l of lots) {
        if (l.product.sku.startsWith('PROCE')) continue;
        
        const pendingQty = inPending[l.productId + '_' + l.lotNumber] || 0;
        const availableQty = l.currentQuantity - pendingQty;

        const alreadyDelivered = Math.max(0, l.initialQuantity - l.currentQuantity);

        // TRUE PUCHOS:
        // 1. It must have had a partial delivery before (alreadyDelivered > 0)
        // 2. The remaining amount must be small (<= 30 units), ensuring we avoid giant batches that are currently mid-packaging!
        if (availableQty > 0 && alreadyDelivered > 0 && availableQty <= 30) {
            itemsToHandOff.push({
                productId: l.productId,
                lotNumber: l.lotNumber,
                requestedQuantity: availableQty,
                ncQuantity: 0
            });
        }
    }

    if (itemsToHandOff.length === 0) {
        console.log("No hay puchos (residuos menores a 30).");
        return;
    }
    
    const handoff = await handoffService.createHandoff({
        userId: user.id,
        items: itemsToHandOff,
        notes: "Auto-generado por el sistema: Acta final de saldos. Solo incluye fracciones verdaderamente cortas (<30) de remate.",
        batchNumber: null,
        batchId: null,
        source: 'MANUAL'
    });

    console.log("Acta generada exitosamente:", handoff.handoffNumber);
}

main().catch(console.error).finally(() => prisma.$disconnect());
