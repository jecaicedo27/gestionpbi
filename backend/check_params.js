const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const noteId = '61df6a02-e77f-4493-a5a2-503e3f0fe767';
    
    const note = await prisma.assemblyNote.findUnique({
        where: { id: noteId },
        include: { processType: true }
    });

    console.log("Batch Note processType:", note.processType.code);
}
main().finally(() => prisma.$disconnect());
