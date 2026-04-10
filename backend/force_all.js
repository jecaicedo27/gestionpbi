const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batchNumber = 'MANGO-BICHE-CON-SAL-260409-0705';
    
    const batch = await prisma.productionBatch.findUnique({
        where: { batchNumber }
    });

    if (!batch) return;

    const empaqueNotes = await prisma.assemblyNote.findMany({
        where: { productionBatchId: batch.id, processType: { code: 'EMPAQUE' } },
        include: { items: { include: { component: true } } }
    });

    for (const empNote of empaqueNotes) {
        for (const item of empNote.items) {
           if (!item.componentId || item.materialLotId) continue;
           
           const qty = Math.ceil(item.plannedQuantity || 0);
           const zoneStock = item.component?.productionZoneStock || 0;
           
           if (zoneStock < qty * 0.95) {
               const diff = qty - zoneStock;
               await prisma.product.update({
                   where: { id: item.componentId },
                   data: {
                       productionZoneStock: qty,
                       currentStock: { decrement: diff > 0 ? diff : 0 }
                   }
               });
               console.log(`Injected ${diff} logic for ${item.component?.name}. New zone stock: ${qty}`);
           }
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
