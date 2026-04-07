const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const lotNumber = 'CHAMOY-260326-0151';
    const adminId = 'fdbf8d09-5770-44d2-99e4-5dd7c9dbb2ab';

    // Get the batch
    const batch = await p.productionBatch.findFirst({ where: { batchNumber: lotNumber } });
    if (!batch) throw new Error('Batch not found');

    // Get the ENSAMBLE note for 1150g to get the productId
    const ensambleNote = await p.assemblyNote.findFirst({
        where: { productionBatchId: batch.id, stageName: { contains: '1150' }, processType: { code: 'ENSAMBLE' } },
        select: { productId: true, actualQuantity: true }
    });
    if (!ensambleNote) throw new Error('ENSAMBLE 1150g not found');

    const productId = ensambleNote.productId;
    const qty = ensambleNote.actualQuantity || 134; // Use actual from Siigo RPA

    console.log('ProductId:', productId, '| qty:', qty);

    // Check existing
    const existing = await p.finishedLotStock.findUnique({
        where: { productId_lotNumber_zone: { productId, lotNumber, zone: 'PRODUCCION' } }
    });
    if (existing) { console.log('Ya existe:', existing.currentQuantity, 'uds'); return; }

    const stock = await p.$transaction(async (tx) => {
        const s = await tx.finishedLotStock.create({
            data: { productId, lotNumber, zone: 'PRODUCCION', initialQuantity: qty, currentQuantity: qty, batchId: batch.id, status: 'AVAILABLE' }
        });
        await tx.finishedLotTransfer.create({
            data: {
                finishedLotStockId: s.id,
                productId,
                transferredById: adminId,
                lotNumber, fromZone: 'PRODUCCION', toZone: 'PRODUCCION', quantity: qty,
                reason: 'Ingreso desde producción (corrección post-guard)',
            }
        });
        return s;
    });
    console.log('✅', stock.currentQuantity, 'uds LIQUIPOPS CHAMOY 1150g en PRODUCCION (lote:', lotNumber, ')');
    console.log('→ En logística, transferir 4 uds de este lote a zona NO_CONFORME.');
}

main().catch(console.error).finally(() => p.$disconnect());
