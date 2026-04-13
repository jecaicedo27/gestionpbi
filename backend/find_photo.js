const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const notes = await prisma.assemblyNote.findMany({
        where: {
            processParameters: {
                path: [],
                string_contains: '1774973941444.jpg'
            }
        }
    });
    for (const note of notes) {
        console.log(note.noteNumber, note.processTypeId, note.stageName);
        console.log(JSON.stringify(note.processParameters, null, 2));
    }
}
run();
