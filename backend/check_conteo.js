const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const empaqueNoteId = '422a54e2-e612-422c-b8e3-d31982314440';
    const empaqueNote = await prisma.assemblyNote.findUnique({
        where: { id: empaqueNoteId },
        include: { productionBatch: true }
    });

    if (!empaqueNote) {
        console.log("No Empaque Note found.");
        return;
    }

    const batchId = empaqueNote.productionBatchId;
    console.log("Batch ID:", batchId);

    const notes = await prisma.assemblyNote.findMany({
        where: { productionBatchId: batchId },
        include: { processType: true }
    });

    const conteoNote = notes.find(n => n.processType?.code === 'CONTEO' || n.stageName === "CONTEO" || (typeof n.processParameters === 'object' && n.processParameters && n.processParameters.conteo));
    
    if (conteoNote) {
        console.log("CONTEO Note ID:", conteoNote.id, "Stage name:", conteoNote.stageName);
        console.log("CONTEO Parameters:", JSON.stringify(conteoNote.processParameters, null, 2));
    } else {
        console.log("No CONTEO Note found!");
        const notesWithConteo = notes.filter(n => typeof n.processParameters === 'object' && n.processParameters && JSON.stringify(n.processParameters).includes('conteo'));
        console.log('Notes with conteo:', notesWithConteo.map(n => ({ id: n.id, stageName: n.stageName })));
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
