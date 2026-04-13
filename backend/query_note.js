const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const notes = await prisma.siigoAssemblyNote.findMany({
        where: {
            // OR: [{ productCode: 'PROCELIQUIPOPS13' }, { id: { contains: 'COCO' } }]
            createdAt: { gte: new Date('2026-04-12T00:00:00Z') }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
    });
    
    // Find the specific one
    const cocoNote = notes.find(n => n.productCode === 'PROCELIQUIPOPS13' && JSON.stringify(n.payload).includes('COCO-260410-0843'));
    if (cocoNote) {
        console.log(JSON.stringify(cocoNote, null, 2));
    } else {
        console.log("No note found with exactly that lot, here are the most recent 5 notes for PROCELIQUIPOPS:");
        console.log(notes.filter(n => n.productCode?.startsWith('PROCELIQUIPOPS')).map(n => ({ id: n.id, productCode: n.productCode, status: n.status, createdAt: n.createdAt })));
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
