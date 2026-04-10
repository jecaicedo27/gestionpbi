const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const batchNumber = 'MANGO-BICHE-CON-SAL-260409-0705';
    
    const batch = await prisma.productionBatch.findUnique({
        where: { batchNumber },
        include: { notes: { include: { processType: true }, orderBy: { sequence: 'asc' } } }
    });

    if (!batch) {
        console.log(`Batch ${batchNumber} not found.`);
        return;
    }

    const firstNote = batch.notes[0];
    console.log(`First note: ${firstNote.noteNumber} | ${firstNote.processType?.code}`);
    
    const empaqueNotes = await prisma.assemblyNote.findMany({
        where: { productionBatchId: batch.id, processType: { code: 'EMPAQUE' } },
        include: { items: { include: { component: true } } }
    });

    console.log(`\nValidating EMPAQUE requirements for batch ${batchNumber}:`);
    
    for (const empNote of empaqueNotes) {
        for (const item of empNote.items) {
           if (!item.componentId || item.materialLotId) continue;
           
           const qty = item.plannedQuantity || 0;
           const zoneStock = item.component?.productionZoneStock || 0;
           
           console.log(`- ${item.component?.name}: Planned = ${qty}, Needed (95%) = ${(qty * 0.95).toFixed(2)}, Zone Stock = ${zoneStock}`);
           
           if (zoneStock < qty * 0.95) {
               console.log(`  ❌ BLOCKED: Shortage of ${qty - zoneStock} units`);
           } else {
               console.log(`  ✅ OK`);
           }
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
