const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const fixes = [
    { contains: '3400', productId: 'acbb1e66-2456-4610-8c0c-537367b6b1eb', name: 'LIQUIPOPS SABOR A FRESA X 3400 GR' },
    { contains: '1150', productId: 'f734fca2-32ca-45db-85b5-4faf84d44cd0', name: 'LIQUIPOPS SABOR A FRESA X 1150 GR' },
    { contains: '350g', productId: 'aa634b87-d0a5-4b2b-ac65-573bdba64ecb', name: 'LIQUIPOPS SABOR A FRESA X 350 GR' },
];

async function main() {
    const notes = await p.assemblyNote.findMany({
        where: {
            status: { in: ['PENDING', 'EXECUTING'] },
            processType: { code: 'ENSAMBLE' },
            product: { name: { contains: 'ETIQUETA', mode: 'insensitive' } }
        },
        include: { product: { select: { name: true } } }
    });

    console.log('Notas con producto ETIQUETA incorrecto:', notes.length);

    for (const note of notes) {
        const fix = fixes.find(f => (note.stageName || '').toLowerCase().includes(f.contains.toLowerCase()));
        if (!fix) { console.log(' ⚠️ Sin fix para:', note.stageName); continue; }
        await p.assemblyNote.update({ where: { id: note.id }, data: { productId: fix.productId } });
        console.log(' ✅', note.noteNumber, '(', note.stageName, ') →', fix.name);
    }
    console.log('Listo.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); }).finally(() => p.$disconnect());
