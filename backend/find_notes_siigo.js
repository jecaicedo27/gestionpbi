const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function findNotes() {
    try {
        const notes = await prisma.assemblyNote.findMany({
            where: { 
                product: { name: { contains: 'BASE SIROPE' } }
            },
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: { product: true, rpaExecutions: true }
        });
        console.log(JSON.stringify(notes, null, 2));
    } finally {
        prisma.$disconnect();
    }
}

findNotes();
