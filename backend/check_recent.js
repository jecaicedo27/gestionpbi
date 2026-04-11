const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const notes = await prisma.assemblyNote.findMany({
        where: {
            OR: [
                { generatedLotCode: 'TAMARINDO-260410-0645' },
                { description: { contains: 'TAMARINDO-260410-0645' } }
            ]
        },
        include: {
            product: true
        }
    });

    if (notes.length === 0) {
        console.log("Not found by generatedLotCode. Looking for generic recent notes:");
        const recent = await prisma.assemblyNote.findMany({
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: { id: true, generatedLotCode: true, currentStage: true, productId: true, customData: true, outputs: true }
        });
        console.log(JSON.stringify(recent, null, 2));
    } else {
        console.log("FOUND:");
        console.log(JSON.stringify(notes, null, 2));
    }
}
main().finally(() => prisma.$disconnect());
