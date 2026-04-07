const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const note = await prisma.assemblyNote.findFirst({
        where: {
            productionBatch: { batchNumber: { contains: 'LYCHE-260325-1103' } },
            processType: { code: 'EMPAQUE' }, status: 'COMPLETED'
        },
        include: {
            product: { select: { id: true, name: true } },
            productionBatch: { select: { batchNumber: true, id: true } }
        }
    });
    if (!note) throw new Error('EMPAQUE note not found');

    const ep = note.processParameters || {};
    const qty = ep.empaqueRef?.conteo_qty || ep.empaque?.conteo_qty || note.targetQuantity;
    const { productId } = note;
    const lotNumber = note.productionBatch.batchNumber;
    const batchId = note.productionBatchId;
    const adminId = 'fdbf8d09-5770-44d2-99e4-5dd7c9dbb2ab';

    console.log('Inyectando:', note.product?.name, '| lote:', lotNumber, '| qty:', qty);

    const existing = await prisma.finishedLotStock.findUnique({
        where: { productId_lotNumber_zone: { productId, lotNumber, zone: 'PRODUCCION' } }
    });
    if (existing) { console.log('Ya existe:', existing.currentQuantity, 'uds'); return; }

    const stock = await prisma.$transaction(async (tx) => {
        const s = await tx.finishedLotStock.create({
            data: { productId, lotNumber, zone: 'PRODUCCION', initialQuantity: qty, currentQuantity: qty, batchId, status: 'AVAILABLE' }
        });
        // Use raw FK fields (same pattern as finishedLotService.js)
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
    console.log('✅', stock.currentQuantity, 'uds de SIROPE LYCHE en PRODUCCION');
}

main().catch(console.error).finally(() => prisma.$disconnect());
