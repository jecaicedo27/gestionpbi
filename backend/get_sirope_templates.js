const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const templates = await prisma.assemblyTemplate.findMany({
        include: {
            stages: {
                include: { processType: true },
                orderBy: { stageOrder: 'asc' }
            },
            product: {
                select: { name: true }
            }
        }
    });
    
    for (const t of templates) {
        if (t.product && t.product.name.toUpperCase().includes("SIROPE")) {
            console.log(`\nTemplate: ${t.templateCode} - ${t.product.name} (Active: ${t.isActive})`);
            t.stages.forEach(s => {
                console.log(`  Stage ${s.stageOrder}: ${s.processType.code} - ${s.stageName}`);
            });
        }
    }
}
main().finally(() => prisma.$disconnect());
