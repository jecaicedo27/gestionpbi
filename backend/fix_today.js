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

    console.log(`Encontradas ${notes.length} notas de EMPAQUE completadas hoy.`);
    for (const note of notes) {
        console.log(`\n--- Nota: ${note.stageName} (${note.id}) ---`);
        for (const item of note.items) {
            if (!item.consumed && item.componentId && !item.component?.name.toUpperCase().includes('AGUA')) {
                const qty = item.actualQuantity || item.plannedQuantity || 0;
                console.log(`[FALTA CONSUMIR] ${item.component?.name}: ${qty} unidades (Consumed Flag: ${item.consumed})`);
            }
        }
        
        // Ver si se mandó al RPA
        const rpa = await prisma.rpaExecution.findFirst({
            where: { assemblyNoteId: note.id }
        });
        if (!rpa && note.product?.accountGroup === 1401) {
             console.log(`[FALTA RPA] Producto Terminado ${note.product?.name} NO tiene RPA`);
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
