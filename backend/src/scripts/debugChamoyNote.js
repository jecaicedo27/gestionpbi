const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    const note = await p.assemblyNote.findFirst({
        where: { id: '19b7d5e3-64ac-4bff-b46c-39312700acfb' },
        include: { items: { include: { component: { select: { name: true } } } } }
    });
    if (!note) { console.log('not found by UI ID – searching by stageName'); 
        // fallback: find 1150g note
        const n2 = await p.assemblyNote.findFirst({
            where: { productionBatch: { batchNumber: 'CHAMOY-260326-0151' }, stageName: { contains: '1150' } },
            include: { items: { include: { component: { select: { name: true } } } } }
        });
        if (!n2) { console.log('still not found'); return; }
        console.log('Found by name. ID:', n2.id, '| stageName:', n2.stageName, '| status:', n2.status);
        console.log('empaqueRef:', JSON.stringify(n2.processParameters?.empaqueRef));
        n2.items.forEach(i => console.log('  item:', i.id, i.component?.name, '| planned:', i.plannedQuantity, '| actual:', i.actualQuantity));
        return;
    }
    console.log('stageName:', note.stageName, '| status:', note.status);
    console.log('empaqueRef:', JSON.stringify(note.processParameters?.empaqueRef));
    note.items.forEach(i => console.log('  item:', i.id, i.component?.name, '| planned:', i.plannedQuantity, '| actual:', i.actualQuantity));
}

main().catch(console.error).finally(() => p.$disconnect());
