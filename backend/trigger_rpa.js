const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function triggerMissingRPA() {
    try {
        const noteId = 'b137a94e-373f-4625-986f-fbf34f832688';
        
        // Ensure note doesn't already have an RPA execution
        const existing = await prisma.rpaExecution.findFirst({
            where: { assemblyNoteId: noteId }
        });

        if (existing) {
            console.log('RPA already exists for this note:', existing);
            return;
        }

        // Get the note to get the user who executed it
        const note = await prisma.assemblyNote.findUnique({
            where: { id: noteId },
            include: { product: true }
        });

        if (!note) {
            console.log('NOTE NOT FOUND!');
            return;
        }

        console.log(`Queueing RPA for Note: ${note.noteNumber} (${note.product.name})`);

        await prisma.rpaExecution.create({
            data: {
                executionType: 'SIIGO_ASSEMBLY',
                status: 'PENDING',
                productName: note.product.name,
                quantity: 700000, // 700 KG
                assemblyType: 'proceso',
                observations: `Lote: Inyección manual (Ensamble extrañado). Base Sirope Clasica 700kg.`,
                assemblyNoteId: noteId,
                triggeredById: note.executedById || note.createdById
            }
        });

        console.log('RPA Execution created and queued! The worker will pick it up.');
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

triggerMissingRPA();
