require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
    const noteId = 'cdc6fde9-1f46-45d4-a2db-de1dc079853a';
    const note = await p.assemblyNote.findUnique({ where: { id: noteId } });

    // Fix BASE LIQUIPOPS stage input (120000 -> 118004) 
    const stageInputs = await p.assemblyTemplateStageInput.findMany({
        where: { stageId: note.stageId }, include: { product: true }
    });
    const baseInput = stageInputs.find(i => i.product && i.product.name === 'BASE LIQUIPOPS');
    if (baseInput && baseInput.quantityPerUnit === 120000) {
        await p.assemblyTemplateStageInput.update({
            where: { id: baseInput.id },
            data: { quantityPerUnit: 118004 }
        });
        console.log('✅ Fixed BASE LIQUIPOPS stage input: 120000 -> 118004');
    } else {
        console.log('BASE LIQUIPOPS stage input already correct:', baseInput?.quantityPerUnit);
    }

    // Add CONSERVANTES to note items if missing
    const conservante = await p.product.findFirst({
        where: { name: { contains: 'PREMEZCLA CONSERVANTES' } }
    });
    if (conservante) {
        const existing = await p.assemblyNoteItem.findFirst({
            where: { assemblyNoteId: noteId, componentId: conservante.id }
        });
        if (!existing) {
            await p.assemblyNoteItem.create({
                data: { assemblyNoteId: noteId, componentId: conservante.id, plannedQuantity: 1, unit: 'unidad' }
            });
            console.log('✅ Added PREMEZCLA CONSERVANTES PERLAS (1 unidad)');
        } else {
            console.log('CONSERVANTES already in note');
        }
    }

    // Final verification
    const fin = await p.assemblyNote.findUnique({
        where: { id: noteId },
        include: { items: { include: { component: true } } }
    });
    console.log('\n=== CORRECTED ITEMS ===');
    fin.items.forEach(i => {
        console.log(i.component?.name + ': ' + i.plannedQuantity + ' ' + i.unit);
    });

    await p.$disconnect();
})();
