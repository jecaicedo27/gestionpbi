const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    const stage = await prisma.assemblyTemplateStage.findFirst({
        where: { stageName: 'Pesaje de BASE SIROPE CLASICA' },
        include: { processType: true }
    });
    console.log(stage);
}
check().catch(console.error).finally(() => prisma.$disconnect());
