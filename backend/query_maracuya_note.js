const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const note = await prisma.assemblyNote.findFirst({
        where: { noteNumber: 'MARACUYA-260331-1953-S5' },
        include: { items: { include: { component: true } } }
    });
    if (!note) {
        console.log("Note not found");
        return;
    }
    console.log("Note:", note.noteNumber);
    console.log("Process Params weighing_photos:", note.processParameters && note.processParameters.weighing_photos);
    console.log("Process Params weighing_data:", note.processParameters && note.processParameters.weighing_data);
    
    console.log("Items:");
    note.items.forEach(i => {
        console.log(`  ID: ${i.id}`);
        console.log(`  Component: ${i.component ? i.component.name : 'Unknown'} (${i.componentId})`);
    });
}
run();
