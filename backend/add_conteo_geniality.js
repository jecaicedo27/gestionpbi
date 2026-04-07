const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
    const tmplId = 'df82901e-64b3-4b7b-8c3c-796a68fe91a3';
    const conteoTypeId = '646507ff-f327-44f9-bdaa-1d8655bcda04';

    // Get current stages
    const stages = await p.assemblyTemplateStage.findMany({
        where: { templateId: tmplId },
        orderBy: { stageOrder: 'asc' },
        include: { processType: true }
    });
    console.log('Current stages:');
    stages.forEach(s => console.log('  S' + s.stageOrder + ' ' + s.stageName + ' [' + s.processType?.code + '] id=' + s.id));

    const hasConteo = stages.some(s => s.processType?.code === 'CONTEO');
    if (hasConteo) {
        console.log('CONTEO already exists — skipping');
        await p.$disconnect();
        return;
    }

    const hasS3 = stages.some(s => s.stageOrder === 3);
    if (!hasS3) {
        // Gap at S3 from previous partial shift
        console.log('Gap at S3 found — inserting CONTEO there');
    } else {
        // Shift existing stages: S3→S4, S4→S5, etc.
        const sorted = [...stages].sort((a, b) => b.stageOrder - a.stageOrder);
        for (const s of sorted) {
            if (s.stageOrder >= 3) {
                await p.assemblyTemplateStage.update({ where: { id: s.id }, data: { stageOrder: s.stageOrder + 1 } });
                console.log('Shifted S' + s.stageOrder + ' → S' + (s.stageOrder + 1));
            }
        }
    }

    // Create CONTEO stage at S3
    const conteoStage = await p.assemblyTemplateStage.create({
        data: {
            templateId: tmplId,
            stageOrder: 3,
            stageName: 'Conteo de Producción por Referencia',
            processTypeId: conteoTypeId,
            isRequired: true
        }
    });
    console.log('Created CONTEO stage at S3: ' + conteoStage.id);

    // Verify final structure
    const final = await p.assemblyTemplateStage.findMany({
        where: { templateId: tmplId },
        orderBy: { stageOrder: 'asc' },
        include: { processType: true }
    });
    console.log('\nFinal BATCH-GENIALITY stages:');
    final.forEach(s => console.log('  S' + s.stageOrder + ' ' + s.stageName + ' [' + s.processType?.code + ']'));

    await p.$disconnect();
})();
