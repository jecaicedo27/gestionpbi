const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const tpl = await prisma.assemblyTemplate.findFirst({ where: { templateCode: { contains: 'ESCARCHADOR' } } });
    if(tpl) {
        const stages = await prisma.assemblyTemplateStage.findMany({ where: { templateId: tpl.id }, orderBy: { stageOrder: 'asc'} });
        console.log("TEMPLATE: " + tpl.templateCode);
        console.log(stages.map(s => `${s.stageOrder}: ${s.stageName}`).join('\n'));
    } else {
        console.log('No ESCARCHADOR template');
    }
}
main().finally(() => prisma.$disconnect());
