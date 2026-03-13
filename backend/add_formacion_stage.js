require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
    // Get ESFERAS FRESA template
    const tmpl = await p.assemblyTemplate.findFirst({
        where: { product: { name: { contains: 'ESFERAS FRESA' } } },
        include: {
            stages: { include: { processType: true }, orderBy: { stageOrder: 'asc' } },
            product: true
        }
    });
    console.log('Template:', tmpl.name || tmpl.product?.name, tmpl.id);
    tmpl.stages.forEach(s => console.log(s.stageOrder + '. ' + (s.name || s.processType?.name) + ' (' + s.processType?.code + ')'));

    // Check if FORMACION stage already exists
    const hasFormacion = tmpl.stages.some(s => s.processType?.code === 'FORMACION');
    if (hasFormacion) {
        console.log('\nFORMACION stage already exists');
    } else {
        // Get FORMACION process type
        const formacionType = await p.assemblyProcessType.findFirst({ where: { code: 'FORMACION' } });
        if (!formacionType) {
            console.log('ERROR: FORMACION process type not found');
            await p.$disconnect();
            return;
        }

        // Insert FORMACION stage between PESAJE (1) and ENSAMBLE (2)
        // First push ENSAMBLE to stageOrder 3
        const ensambleStage = tmpl.stages.find(s => s.processType?.code === 'ENSAMBLE');
        if (ensambleStage) {
            await p.assemblyTemplateStage.update({
                where: { id: ensambleStage.id },
                data: { stageOrder: 3 }
            });
            console.log('Moved ENSAMBLE to stageOrder 3');
        }

        // Create FORMACION stage at stageOrder 2
        const newStage = await p.assemblyTemplateStage.create({
            data: {
                templateId: tmpl.id,
                processTypeId: formacionType.id,
                stageOrder: 2,
                name: 'Formación de Esferas'
            }
        });
        console.log('Created FORMACION stage:', newStage.id, 'at stageOrder 2');

        // Also update any existing notes for this batch that have stageOrder >= 2
        // to push them forward
        const batches = await p.productionBatch.findMany({
            where: { templateId: tmpl.id }
        });
        for (const batch of batches) {
            // Push ENSAMBLE notes to stageOrder 3
            await p.assemblyNote.updateMany({
                where: {
                    productionBatchId: batch.id,
                    stageOrder: 2,
                    processType: { code: 'ENSAMBLE' }
                },
                data: { stageOrder: 3 }
            });
        }
        console.log('Updated existing batch notes stageOrder');
    }

    // Verify
    const updated = await p.assemblyTemplate.findFirst({
        where: { id: tmpl.id },
        include: {
            stages: { include: { processType: true }, orderBy: { stageOrder: 'asc' } }
        }
    });
    console.log('\n=== UPDATED TEMPLATE STAGES ===');
    updated.stages.forEach(s => console.log(s.stageOrder + '. ' + (s.name || s.processType?.name) + ' (' + s.processType?.code + ')'));

    await p.$disconnect();
})();
