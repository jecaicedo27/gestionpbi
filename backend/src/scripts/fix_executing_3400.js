/**
 * fix_executing_3400.js
 * 
 * Fix específico para la nota EXECUTING del Ensamble 3400g:
 * 1. Elimina el SELLO duplicado
 * 2. Agrega el TARRO LIQUIPOPS 3400 GR como AssemblyNoteItem
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const NOTE_ID = 'd0732039-abf2-4eef-ad8a-08a710e13676';

async function main() {
    // 1. Buscar la nota
    const note = await p.assemblyNote.findUnique({
        where: { id: NOTE_ID },
        include: {
            items: { include: { component: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } }
        }
    });

    if (!note) { console.log('❌ Nota no encontrada'); return; }
    console.log(`📝 Nota: ${note.noteNumber} (${note.stageName}) — status: ${note.status}`);
    console.log(`   Items actuales: ${note.items.length}`);
    note.items.forEach((i, idx) => console.log(`   ${idx + 1}. ${i.component?.name} | ${i.plannedQuantity} ${i.unit} | id: ${i.id}`));

    // 2. Eliminar duplicados (mismo componentId más de una vez)
    const seen = new Set();
    const toDelete = [];
    for (const item of note.items) {
        if (seen.has(item.componentId)) {
            toDelete.push(item);
        } else {
            seen.add(item.componentId);
        }
    }

    if (toDelete.length > 0) {
        console.log(`\n🗑️  Eliminando ${toDelete.length} duplicado(s):`);
        for (const dup of toDelete) {
            console.log(`   - ${dup.component?.name} (id: ${dup.id})`);
            await p.assemblyNoteItem.delete({ where: { id: dup.id } });
        }
    } else {
        console.log('\n✅ Sin duplicados en la nota');
    }

    // 3. Buscar el TARRO LIQUIPOPS 3400 GR en la tabla de productos
    const tarro = await p.product.findFirst({
        where: {
            name: { contains: 'TARRO LIQUIPOPS 3400', mode: 'insensitive' }
        },
        select: { id: true, name: true }
    });

    if (!tarro) { console.log('\n❌ Producto TARRO 3400 no encontrado en products'); return; }
    console.log(`\n🛢️  TARRO encontrado: ${tarro.name} (id: ${tarro.id})`);

    // 4. Verificar si ya existe en la nota (o si acabamos de borrar el duplicado pero queda uno)
    const refreshedItems = await p.assemblyNoteItem.findMany({ where: { noteId: NOTE_ID } });
    const alreadyHasTarro = refreshedItems.some(i => i.componentId === tarro.id);

    if (alreadyHasTarro) {
        console.log('   ℹ️  El TARRO ya existe en la nota — no se agrega');
    } else {
        // Buscar el quantityPerUnit del template para este item
        const templateInput = await p.assemblyTemplateStageInput.findFirst({
            where: { stageId: note.stageId, productId: tarro.id }
        });

        const plannedQty = templateInput?.quantityPerUnit ?? 1;
        const unit = templateInput?.unit ?? 'unidad';

        console.log(`   📊 plannedQuantity del template: ${plannedQty} ${unit}`);

        const newItem = await p.assemblyNoteItem.create({
            data: {
                noteId: NOTE_ID,
                componentId: tarro.id,
                plannedQuantity: plannedQty,
                unit: unit,
                actualQuantity: null,
                lotNumber: null,
            }
        });

        console.log(`   ✅ TARRO agregado como AssemblyNoteItem (id: ${newItem.id})`);
    }

    // Resumen final
    const finalItems = await p.assemblyNoteItem.findMany({
        where: { noteId: NOTE_ID },
        include: { component: { select: { name: true } } },
        orderBy: { createdAt: 'asc' }
    });
    console.log(`\n📋 Items finales en la nota (${finalItems.length}):`);
    finalItems.forEach((i, idx) => console.log(`   ${idx + 1}. ${i.component?.name} | ${i.plannedQuantity} ${i.unit}`));
}

main()
    .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
    .finally(() => p.$disconnect());
