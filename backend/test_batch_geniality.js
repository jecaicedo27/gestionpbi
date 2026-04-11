const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const tmpl = await prisma.assemblyTemplate.findFirst({
        where: { templateCode: 'BATCH-GENIALITY' },
        include: {
            stages: { include: { processType: true }, orderBy: { stageOrder: 'asc' } }
        }
    });
    console.log("BATCH-GENIALITY stages:");
    tmpl.stages.forEach(s => console.log(`  Stage: ${s.stageOrder} | ${s.stageName} | Process: ${s.processType.code}`));
}
main().finally(() => prisma.$disconnect());
