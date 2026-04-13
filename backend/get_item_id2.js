const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const note = await prisma.assemblyNote.findFirst({
        where: { noteNumber: 'MARACUYA-260331-1140-S2' },
        include: { items: { include: { component: true } } }
    });
    console.log(note.noteNumber);
    for (const item of note.items) {
        console.log(item.id, item.component.name);
    }
}
run();
