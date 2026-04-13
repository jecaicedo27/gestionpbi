const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const note = await prisma.assemblyNote.findFirst({
        where: { noteNumber: 'MARACUYA-260401-0632-S3' },
        include: { items: { include: { component: true } } }
    });
    for (const item of note.items) {
        console.log(item.id, item.component.name);
    }
}
run();
