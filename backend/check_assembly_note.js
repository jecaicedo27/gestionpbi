const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const note = await prisma.assemblyNote.findFirst({
        where: { productionBatchId: '6fd58647-57a0-4367-909c-224dd1abfa84' },
        include: { items: true },
        orderBy: { stageOrder: 'asc' }
    });
    console.log(note);
}
check().catch(console.error).finally(() => prisma.$disconnect());
