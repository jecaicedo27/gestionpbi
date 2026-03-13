/**
 * cleanup_duplicate_sello.js
 * 
 * Removes duplicate SELLO DE SEGURIDAD items from PENDING assembly notes.
 * A duplicate = same componentId appearing more than once in the same note.
 * 
 * Safe: only touches AssemblyNoteItem records for PENDING notes.
 * Run: node backend/src/scripts/cleanup_duplicate_sello.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🔍 Buscando notas PENDING con SELLOs duplicados...\n');

    // Get all PENDING notes for ENSAMBLE stages
    const pendingNotes = await prisma.assemblyNote.findMany({
        where: {
            status: 'PENDING',
            processType: { code: 'ENSAMBLE' }
        },
        include: {
            items: {
                include: { component: { select: { id: true, name: true } } },
                orderBy: { createdAt: 'asc' }
            }
        }
    });

    console.log(`📋 Notas PENDING ENSAMBLE encontradas: ${pendingNotes.length}`);

    let totalDeleted = 0;

    for (const note of pendingNotes) {
        // Group items by componentId — find any componentId with >1 items
        const byComponent = {};
        for (const item of note.items) {
            if (!byComponent[item.componentId]) byComponent[item.componentId] = [];
            byComponent[item.componentId].push(item);
        }

        // Find duplicates
        const duplicates = Object.entries(byComponent).filter(([, items]) => items.length > 1);
        if (duplicates.length === 0) continue;

        console.log(`\n  📝 Nota: ${note.noteNumber} (${note.stageName})`);

        for (const [componentId, items] of duplicates) {
            const name = items[0].component?.name || componentId;
            // Keep the first one (oldest createdAt), delete the rest
            const toDelete = items.slice(1);
            console.log(`    ⚠️  "${name}" aparece ${items.length}x → borrando ${toDelete.length} duplicado(s)`);
            console.log(`       IDs a borrar: ${toDelete.map(i => i.id).join(', ')}`);

            for (const dup of toDelete) {
                await prisma.assemblyNoteItem.delete({ where: { id: dup.id } });
                totalDeleted++;
            }
        }
    }

    console.log(`\n✅ Listo. ${totalDeleted} item(s) duplicado(s) eliminados.`);
    if (totalDeleted === 0) {
        console.log('   (Sin duplicados encontrados — notas ya están limpias)');
    }
}

main()
    .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
