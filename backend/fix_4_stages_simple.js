const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
    try {
        const liqd01 = await prisma.product.findFirst({ where: { sku: 'LIQD01' } });
        const template = await prisma.assemblyTemplate.findFirst({
            where: { productId: liqd01.id }
        });

        console.log(`Updating template: ${template.templateName}`);

        // Delete existing stages and notes
        await prisma.assemblyTemplateStage.deleteMany({ where: { templateId: template.id } });
        await prisma.assemblyNote.deleteMany({ where: { templateId: template.id } });

        // Get process types and products
        const procesos = await prisma.processType.findMany();
        const procesoMezcla = procesos.find(p => p.name.includes('Mezcla'));
        const procesoEsferificacion = procesos.find(p => p.name.includes('Esferificación'));
        const procesoEnvasado = procesos.find(p => p.name.includes('Envasado'));

        const base = await prisma.product.findFirst({ where: { sku: 'PROCELIQUIPOPS01' } });
        const jarabe = await prisma.product.findFirst({ where: { name: { contains: 'Jarabe Fresa' } } });

        console.log('\\nCreating 4 stages...');

        // Stage 1: Crear Base
        const stage1 = await prisma.assemblyTemplateStage.create({
            data: {
                templateId: template.id,
                stageOrder: 1,
                stageName: 'Crear Base Liquipops',
                processTypeId: procesoMezcla.id,
                outputProductId: base.id,
                outputClassification: 'SEMITERMINADO'
            }
        });
        console.log('✅ Etapa 1: Crear Base');

        // Stage 2: Preparar Jarabe
        const stage2 = await prisma.assemblyTemplateStage.create({
            data: {
                templateId: template.id,
                stageOrder: 2,
                stageName: 'Preparar Jarabe Fresa',
                processTypeId: procesoEsferificacion.id,
                outputProductId: jarabe.id,
                outputClassification: 'SEMITERMINADO'
            }
        });
        console.log('✅ Etapa 2: Preparar Jarabe');

        // Stage 3: Esferificación (uses jarabe as input, output is also considered jarabe ready for use)
        const stage3 = await prisma.assemblyTemplateStage.create({
            data: {
                templateId: template.id,
                stageOrder: 3,
                stageName: 'Esferificación',
                processTypeId: procesoEsferificacion.id,
                outputProductId: jarabe.id, // Using jarabe as output (esferas are jarabe transformed)
                outputClassification: 'SEMITERMINADO'
            }
        });

        // Input: Jarabe from stage 2
        await prisma.assemblyTemplateStageInput.create({
            data: {
                stageId: stage3.id,
                inputType: 'INTERMEDIATE',
                productId: jarabe.id,
                fromStageOrder: 2,
                quantityPerUnit: 100,
                unit: 'ML',
                displayOrder: 1
            }
        });
        console.log('✅ Etapa 3: Esferificación');

        // Stage 4: Envasado
        const stage4 = await prisma.assemblyTemplateStage.create({
            data: {
                templateId: template.id,
                stageOrder: 4,
                stageName: 'Envasado 350g',
                processTypeId: procesoEnvasado.id,
                outputProductId: liqd01.id,
                outputClassification: 'PRODUCTO_TERMINADO'
            }
        });

        // Inputs: Base (stage 1) + Esferas/Jarabe (stage 3)
        await prisma.assemblyTemplateStageInput.create({
            data: {
                stageId: stage4.id,
                inputType: 'INTERMEDIATE',
                productId: base.id,
                fromStageOrder: 1,
                quantityPerUnit: 250,
                unit: 'GRAMOS',
                displayOrder: 1
            }
        });

        await prisma.assemblyTemplateStageInput.create({
            data: {
                stageId: stage4.id,
                inputType: 'INTERMEDIATE',
                productId: jarabe.id,
                fromStageOrder: 3,
                quantityPerUnit: 100,
                unit: 'GRAMOS',
                displayOrder: 2
            }
        });
        console.log('✅ Etapa 4: Envasado');

        // Update template
        await prisma.assemblyTemplate.update({
            where: { id: template.id },
            data: { totalStages: 4 }
        });

        console.log('\\n🎉 Template updated: Base → Jarabe → Esferificación → Envasado');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
})();
