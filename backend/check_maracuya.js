const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const notes = await prisma.assemblyNote.findMany({
        where: { templateName: { contains: 'MARACUYA' } },
        orderBy: { createdAt: 'desc' },
        take: 5
    });
    console.log(notes.map(n => ({ id: n.id, nro: n.batchNumber, tpl: n.templateName, status: n.status, step: n.wizardStep, type: n.processType })));
}
check().finally(() => prisma.$disconnect());
