const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const noteId = '9bb6fbdd-a24a-4dcc-a2c3-705a2b20c445';
    
    const note = await prisma.assemblyNote.findUnique({
        where: { id: noteId },
    });

    if (!note) {
        console.log("Note not found");
        return;
    }

    const allNotes = await prisma.assemblyNote.findMany({
        where: { productionBatchId: note.productionBatchId },
        include: { processType: true }
    });

    for (const n of allNotes) {
        console.log(`Found note: ID: ${n.id}, Type: ${n.processType?.code}, Status: ${n.status}`);
        if (n.processType?.code === 'CONTEO' || n.stageName?.toLowerCase().includes('conteo') || n.processParameters?.carriots) {
             console.log(` ---> carriots count:`, n.processParameters?.carriots?.length || 0);
        }
    }
}
main().finally(() => prisma.$disconnect());
