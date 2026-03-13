require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
    const ft = await p.processType.findFirst({ where: { code: 'FORMACION' } });
    console.log('FORMACION type:', ft?.id, ft?.name, ft?.code);

    const tmplId = 'b8677ed9-fd7b-4ff1-8af5-3d002ac4e72d';

    // Push ENSAMBLE to stageOrder 3
    const ens = await p.assemblyTemplateStage.findFirst({
        where: { templateId: tmplId, processType: { code: 'ENSAMBLE' } }
    });
    if (ens) {
        await p.assemblyTemplateStage.update({ where: { id: ens.id }, data: { stageOrder: 3 } });
        console.log('Pushed ENSAMBLE to stageOrder 3');
    }

    // Create FORMACION stage
    const ns = await p.assemblyTemplateStage.create({
        data: { templateId: tmplId, processTypeId: ft.id, stageOrder: 2, name: 'Formación de Esferas' }
    });
    console.log('Created FORMACION stage:', ns.id);

    // Update existing ESFERAS batch notes
    const batches = await p.productionBatch.findMany({ where: { templateId: tmplId } });
    for (const b of batches) {
        await p.assemblyNote.updateMany({
            where: { productionBatchId: b.id, stageOrder: 2, processType: { code: 'ENSAMBLE' } },
            data: { stageOrder: 3 }
        });
    }
    console.log('Updated batch notes stageOrder');

    // Create FORMACION note for existing PENDING batches
    for (const b of batches) {
        const existing = await p.assemblyNote.findFirst({
            where: { productionBatchId: b.id, processType: { code: 'FORMACION' } }
        });
        if (!existing) {
            const pesajeNote = await p.assemblyNote.findFirst({
                where: { productionBatchId: b.id, processType: { code: 'PESAJE' } },
                include: { product: true }
            });
            if (pesajeNote) {
                await p.assemblyNote.create({
                    data: {
                        productionBatchId: b.id,
                        productId: pesajeNote.productId,
                        processTypeId: ft.id,
                        stageId: ns.id,
                        stageOrder: 2,
                        stageName: 'Formación de Esferas',
                        targetQuantity: pesajeNote.targetQuantity,
                        noteNumber: pesajeNote.noteNumber ? pesajeNote.noteNumber.replace('S1', 'S2') : '',
                        status: 'PENDING'
                    }
                });
                console.log('Created FORMACION note for batch', b.batchNumber);
            }
        }
    }

    // Verify
    if (batches.length > 0) {
        const notes = await p.assemblyNote.findMany({
            where: { productionBatchId: batches[0].id },
            include: { processType: true },
            orderBy: { stageOrder: 'asc' }
        });
        console.log('\nFinal stages for first batch:');
        notes.forEach(n => console.log(n.stageOrder + '. ' + n.stageName + ' (' + n.processType?.code + ') ' + n.status));
    }

    await p.$disconnect();
})();
