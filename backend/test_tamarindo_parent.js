const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const parent = await prisma.assemblyTemplateStage.findMany({
        where: { subTemplateId: '2f454092-8e16-40a4-a5db-a595841c14a1' } // ID of TMPL097 or similar?
    });
    console.log("Parent stages:", parent);
    const tmpl097 = await prisma.assemblyTemplate.findFirst({
        where: { templateCode: 'TMPL097'}
    });
    console.log("TMPL097 ID:", tmpl097?.id);
    const parent2 = await prisma.assemblyTemplateStage.findMany({
        where: { subTemplateId: tmpl097?.id },
        include: { template: true }
    });
    console.log("Parent via ID:", parent2);
}
main().finally(() => prisma.$disconnect());
