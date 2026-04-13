const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const executions = await prisma.rpaExecution.findMany({
        where: {
            productName: { contains: 'COCO' },
            status: 'FAILED',
            createdAt: { gte: new Date('2026-04-12T00:00:00Z') }
        },
        orderBy: { createdAt: 'desc' },
        take: 5
    });
    
    console.log("RPA Executions:", JSON.stringify(executions, null, 2));

    if (executions.length > 0 && executions[0].assemblyNoteId) {
        const note = await prisma.assemblyNote.findUnique({
            where: { id: executions[0].assemblyNoteId },
            include: {
                product: { select: { name: true, sku: true } },
                stage: true,
                items: { include: { component: { select: { name: true }} } }
            }
        });
        console.log("Assembly Note Details:", JSON.stringify(note, null, 2));
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
