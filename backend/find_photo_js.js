const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const notes = await prisma.assemblyNote.findMany({
        where: { processParameters: { not: null } }
    });
    for (const note of notes) {
        const str = JSON.stringify(note.processParameters);
        if (str.includes('1774973941444.jpg')) {
            console.log(note.noteNumber, note.processTypeId, note.stageName);
            console.log(JSON.stringify(note.processParameters, null, 2));
        }
    }
}
run();
