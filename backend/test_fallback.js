const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const note = await prisma.assemblyNote.findFirst({
        where: { noteNumber: 'MARACUYA-260401-0632-S3' }
    });
    if (!note) {
        console.log("Not found");
        return;
    }
    console.log(JSON.stringify(note.processParameters, null, 2));
}
run();
