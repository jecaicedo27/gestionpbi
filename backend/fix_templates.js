const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const sabProducts = await prisma.product.findMany({ where: { name: { startsWith: 'SABORIZACION' } }, select: { id: true, name: true } });
    const baseProduct = await prisma.product.findFirst({ where: { name: 'BASE SIROPE CLASICA' }, select: { id: true, name: true } });
    
    const ids = [...sabProducts.map(p => p.id), baseProduct.id];

    // Find all templates for these products
    const templates = await prisma.assemblyTemplate.findMany({
        where: { productId: { in: ids }, isActive: true },
        include: { stages: true }
    });

    let count = 0;
    for (const t of templates) {
        for (const s of t.stages) {
            if (s.processTypeId === 5 || s.stageName.includes('Ensamble')) { // processType 5 is ENSAMBLE
                console.log(`Deleting stage ${s.stageName} from template ${t.templateCode}`);
                await prisma.assemblyTemplateStageInput.deleteMany({ where: { stageId: s.id } });
                await prisma.assemblyTemplateStage.delete({ where: { id: s.id } });
                count++;
            }
        }
    }
    console.log(`Deleted ${count} Ensamble stages from intermediate templates to prevent recurrence.`);
}
main().finally(() => prisma.$disconnect());
