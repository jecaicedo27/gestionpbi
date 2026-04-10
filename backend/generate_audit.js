const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');

async function main() {
    const batches = await prisma.productionBatch.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: {
            assemblyNotes: {
                include: {
                    processType: true,
                    items: {
                        include: {
                            component: true
                        }
                    }
                }
            }
        }
    });

    let csv = "LOTE,TIPO,PROCESO,COMPONENTE,TIPO_COMPONENTE,PROYECTADO,REAL_CONTADO,CONSUMIDO,DESCUADRE\n";

    for (const batch of batches) {
        // Find if it's geniality or liquipops
        const type = batch.batchNumber.includes('LIQUIPOPS') || batch.batchNumber.includes('BICHE') || batch.batchNumber.includes('BLUEBERRY') ? 'Liquipops' : 'Geniality/Sirope';
        
        for (const note of batch.assemblyNotes) {
            const processName = note.processType?.code || 'UNKNOWN';

            // Get all lot consumptions for this note
            const consumptions = await prisma.lotConsumption.findMany({
                where: { assemblyNoteId: note.id },
                include: { materialLot: { include: { product: true } } }
            });

            for (const item of note.items) {
                if (!item.componentId && !item.materialLotId) continue;
                
                const compName = item.component?.name || item.materialLot?.product?.name || 'Unknown';
                const isPackaging = !item.materialLotId && processName === 'EMPAQUE';
                const compType = isPackaging ? 'Empaque' : 'Materia Prima';
                
                const planned = item.plannedQuantity || 0;
                let actual = item.actualQuantity || planned;
                
                let consumedQty = 0;
                if (isPackaging) {
                    consumedQty = item.consumed ? actual : 0;
                } else {
                    // Match lot consumptions
                    const itemCons = consumptions.filter(c => c.materialLot?.productId === item.componentId || c.materialLotId === item.materialLotId);
                    consumedQty = itemCons.reduce((acc, c) => acc + c.quantityUsed, 0);
                }
                
                const diff = consumedQty - actual;
                
                csv += `"${batch.batchNumber}","${type}","${processName}","${compName}","${compType}",${planned},${actual},${consumedQty},${diff}\n`;
            }
        }
    }

    fs.writeFileSync('/root/.gemini/antigravity/brain/ca3fd07f-ed8c-4035-aac5-85b0cee8edac/auditoria_lotes.csv', csv);
    console.log("Report generated successfully.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
