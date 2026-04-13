const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const note = await prisma.assemblyNote.findFirst({
        where: { noteNumber: 'MARACUYA-250325-0638-S2' },
        include: { items: { include: { component: true } } }
    });
    for (const item of note.items) {
        console.log(item.id, item.component.name);
    }
}
run();
