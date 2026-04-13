const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const notes = await prisma.assemblyNote.findMany({
        where: { processParameters: { not: null } },
        include: { items: { include: { component: true } } }
    });
    for (const note of notes) {
        const str = JSON.stringify(note.processParameters);
        if (str.includes('1774973941444.jpg')) {
            console.log("FOUND IN", note.noteNumber, note.stageName);
            for (const item of note.items) {
                console.log(" ", item.id, item.component.name);
            }
            console.log(JSON.stringify(note.processParameters.weighing_photos, null, 2));
        }
    }
}
run();
