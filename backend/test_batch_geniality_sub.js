const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const tmpl = await prisma.assemblyTemplate.findFirst({
        where: { templateCode: 'BATCH-GENIALITY' },
        include: {
            stages: { include: { processType: true }, orderBy: { stageOrder: 'asc' } }
        }
    });
    tmpl.stages.forEach(s => console.log(`  Stage: ${s.stageOrder} | subTemplateId: ${s.subTemplateId} | name: ${s.stageName}`));
}
main().finally(() => prisma.$disconnect());
