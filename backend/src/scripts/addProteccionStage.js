const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
    // 1. Create ProcessType PROTECCION_GATE
    let pt = await prisma.processType.findFirst({ where: { code: 'PROTECCION_GATE' } });
    if (!pt) {
        pt = await prisma.processType.create({
            data: {
                code: 'PROTECCION_GATE',
                name: 'Validación de Protección',
                category: 'SPECIAL',
                icon: '🛡️',
                color: '#10B981',
                active: true
            }
        });
        console.log('Created ProcessType:', pt.code, pt.id);
    }
    console.log('ProcessType ready:', pt.code, pt.id);

    // 2. Get BATCH-LIQUIPOPS template
    const template = await prisma.assemblyTemplate.findFirst({ where: { templateCode: 'BATCH-LIQUIPOPS' } });
    if (!template) { console.log('Template not found!'); return; }
    console.log('Template:', template.id, template.templateCode);

    // 3. Check if already exists
    const existing = await prisma.assemblyTemplateStage.findFirst({
        where: { templateId: template.id, processTypeId: pt.id }
    });
    if (existing) {
        console.log('Stage already exists at position', existing.stageOrder);
        await prisma.$disconnect();
        return;
    }

    // 4. Shift stages 3-10 to 4-11 (descending to avoid unique constraint)
    const stagesToShift = await prisma.assemblyTemplateStage.findMany({
        where: { templateId: template.id, stageOrder: { gte: 3 } },
        orderBy: { stageOrder: 'desc' }
    });
    for (const stage of stagesToShift) {
        await prisma.assemblyTemplateStage.update({
            where: { id: stage.id },
            data: { stageOrder: stage.stageOrder + 1 }
        });
        console.log('  Shifted', stage.stageName, 'from', stage.stageOrder, 'to', stage.stageOrder + 1);
    }

    // 5. Insert Protección Gate at position 3
    const newStage = await prisma.assemblyTemplateStage.create({
        data: {
            templateId: template.id,
            stageOrder: 3,
            stageName: 'Validación de Protección {SABOR}',
            processTypeId: pt.id,
            processParameters: { flavorDependent: true, flavorRole: 'proteccion_gate' }
        }
    });
    console.log('Created stage:', newStage.stageName, 'at position 3');

    // 6. Update totalStages
    await prisma.assemblyTemplate.update({
        where: { id: template.id },
        data: { totalStages: 11 }
    });
    console.log('Updated totalStages to 11');

    await prisma.$disconnect();
    console.log('Done!');
})();
