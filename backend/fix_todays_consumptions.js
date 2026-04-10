const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const notes = await prisma.assemblyNote.findMany({
        where: {
            processType: { code: 'EMPAQUE' },
            status: 'COMPLETED',
            completedAt: { gte: today }
        },
        include: {
            processType: true,
            product: true,
            productionBatch: true,
            items: {
                include: { component: true }
            }
        }
    });

    let totalFixed = 0;
    let totalRpa = 0;

    for (const note of notes) {
        console.log(`\nRevisando: ${note.stageName} (${note.id})`);
        
        let fixedForNote = false;
        
        for (const item of note.items) {
            if (!item.consumed && item.componentId && !item.component?.name.toUpperCase().includes('AGUA')) {
                const qty = Math.round(item.actualQuantity || item.plannedQuantity || 0);
                if (qty <= 0) continue;
                
                const currentProduct = await prisma.product.findUnique({ where: { id: item.componentId } });
                
                // Usually it tried to consume from Zone, but floored to 0. 
                // We'll just take it from Bodega (currentStock) directly to make up for the 0.
                await prisma.product.update({
                    where: { id: item.componentId },
                    data: { currentStock: { decrement: qty } }
                });

                await prisma.assemblyNoteItem.update({
                    where: { id: item.id },
                    data: { consumed: true, actualQuantity: qty }
                });
                
                console.log(`✅ ${qty} unidades descontadas de Bodega para: ${item.component?.name}`);
                fixedForNote = true;
                totalFixed++;
            }
        }

        // RPA For Geniality Products
        if (note.product?.name.includes('GENIALITY')) {
            const rpa = await prisma.rpaExecution.findFirst({
                where: { assemblyNoteId: note.id }
            });
            if (!rpa) {
                // Determine qty (use Empaque draft actuals)
                const empaqueData = note.processParameters?.empaque;
                const finalQty = empaqueData?.approved_qty || note.actualQuantity || note.targetQuantity;
                
                const lotNum = note.productionBatch?.batchNumber;

                // Create RPA
                const execution = await prisma.rpaExecution.create({
                    data: {
                        executionType: 'SIIGO_ASSEMBLY',
                        status: 'RUNNING',
                        productName: note.product?.sku || note.product?.name,
                        quantity: Math.round(Number(finalQty)),
                        assemblyType: 'proceso',
                        observations: `Lote: ${lotNum}. Proceso: ${note.stageName}. (RE-TRIGGER)`,
                        assemblyNoteId: note.id,
                        triggeredById: note.completedById || null
                    }
                });

                // Enqueue to browser manager - but here we just leave it PENDING so the worker will pick it up?
                // Actually, if we just create it as PENDING, does the worker pick it up?
                // No, rpaWorker only picks up triggers if sent via API or message queue. 
                // Wait, if I just set it to PENDING, is there a cronjob? No, it's pushed to browserManager.
                // It's easier if we let the Siigo worker process it by calling the API or just leaving the record so the user can see it or triggering it manually.
                
                await prisma.rpaExecution.update({
                    where: { id: execution.id },
                    data: { status: 'FAILED', errorMessage: 'Re-encolado manual necesario. Haga clic en Reintentar en el panel RPA.' }
                });
                
                console.log(`🤖 RPA creado (en FAILED para reintento manual) para ${note.product?.name} (${finalQty} uds)`);
                totalRpa++;
            }
        }
    }
    
    console.log(`\n🎉 Completado. Se corrigieron ${totalFixed} insumos y se crearon ${totalRpa} RPA.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
