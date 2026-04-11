const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const note = await prisma.assemblyNote.findUnique({
        where: { id: 'e7781781-d6bd-4fd6-8a05-79a3163ec5a6' },
        include: { processType: true }
    });
    console.log(note.processType);
}
main().finally(() => prisma.$disconnect());
