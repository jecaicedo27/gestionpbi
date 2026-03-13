const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
    console.log('Fijando entradas para plantilla LIQD01...');

    const template = await prisma.assemblyTemplate.findFirst({
        where: { product: { sku: 'LIQD01' } },
        include: { stages: true }
    });

    if (!template) {
        console.error('Plantilla no encontrada');
        return;
    }

    // Identificar productos para inputs
    // Stage 1: Crear Base (Agua, Azúcar, Alginato)
    const pAzucar = await prisma.product.findFirst({ where: { name: { contains: 'Azúcar', mode: 'insensitive' } } });
    const pAlginatoIdx = await prisma.product.findFirst({ where: { name: { contains: 'Alginato', mode: 'insensitive' } } });

    // Stage 2: Preparar Jarabe (Syrup, Colorante)
    const pSyrup = await prisma.product.findFirst({ where: { type: 'SYRUP' } });

    for (const stage of template.stages) {
        // Borrar inputs existentes para este stage
        await prisma.assemblyTemplateStageInput.deleteMany({
            where: { stageId: stage.id }
        });

        if (stage.stageOrder === 1) {
            console.log('Agregando inputs a Etapa 1...');
            if (pAzucar) {
                await prisma.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage.id,
                        productId: pAzucar.id,
                        inputType: 'MATERIAL',
                        quantityPerUnit: 0.5,
                        unit: 'Kg',
                        displayOrder: 1
                    }
                });
            }
            if (pAlginatoIdx) {
                await prisma.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage.id,
                        productId: pAlginatoIdx.id,
                        inputType: 'MATERIAL',
                        quantityPerUnit: 0.1,
                        unit: 'Kg',
                        displayOrder: 2
                    }
                });
            }
        } else if (stage.stageOrder === 2) {
            console.log('Agregando inputs a Etapa 2...');
            if (pSyrup) {
                await prisma.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage.id,
                        productId: pSyrup.id,
                        inputType: 'MATERIAL',
                        quantityPerUnit: 1,
                        unit: 'LITRO',
                        displayOrder: 1
                    }
                });
            }
        } else if (stage.stageOrder === 3) {
            // Esferas Fresa
            const jarabeFresa = await prisma.product.findFirst({ where: { sku: 'PROD-JAR-FRE' } });
            if (jarabeFresa) {
                await prisma.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage.id,
                        productId: jarabeFresa.id,
                        inputType: 'INTERMEDIATE',
                        fromStageOrder: 2,
                        quantityPerUnit: 100,
                        unit: 'ML',
                        displayOrder: 1
                    }
                });
            }
        } else if (stage.stageOrder === 4) {
            const baseLiquipops = await prisma.product.findFirst({ where: { sku: 'PROCELIQUIPOPS01' } });
            const jarabeFresa = await prisma.product.findFirst({ where: { sku: 'PROD-JAR-FRE' } });

            if (baseLiquipops) {
                await prisma.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage.id,
                        productId: baseLiquipops.id,
                        inputType: 'INTERMEDIATE',
                        fromStageOrder: 1,
                        quantityPerUnit: 250,
                        unit: 'GRAMOS',
                        displayOrder: 1
                    }
                });
            }
            if (jarabeFresa) {
                await prisma.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage.id,
                        productId: jarabeFresa.id,
                        inputType: 'INTERMEDIATE',
                        fromStageOrder: 3,
                        quantityPerUnit: 100,
                        unit: 'GRAMOS',
                        displayOrder: 2
                    }
                });
            }
        }
    }

    console.log('Limpiando notas antiguas del batch 6af395ae-e9b3-441e-8b67-fd0393b0e39a...');
    const batchId = '6af395ae-e9b3-441e-8b67-fd0393b0e39a';
    await prisma.assemblyNoteItem.deleteMany({ where: { assemblyNote: { productionBatchId: batchId } } });
    await prisma.assemblyNote.deleteMany({ where: { productionBatchId: batchId } });

    console.log('Regenerando notas...');
    const assemblyService = require('./src/services/assemblyService');
    await assemblyService.generateNotesForBatch(batchId);

    console.log('Listo!');
    await prisma.$disconnect();
}

fix();
