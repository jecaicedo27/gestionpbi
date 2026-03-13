const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
    try {
        // 1. Find LIQD01 product and its template
        const liqd01 = await prisma.product.findFirst({ where: { sku: 'LIQD01' } });
        if (!liqd01) {
            console.log('❌ LIQD01 not found');
            return;
        }

        const template = await prisma.assemblyTemplate.findFirst({
            where: { productId: liqd01.id },
            include: { stages: true }
        });

        if (!template) {
            console.log('❌ Template not found');
            return;
        }

        console.log(`Found template: ${template.templateName}`);

        // 2. Delete existing stages
        console.log('Deleting existing stages...');
        await prisma.assemblyTemplateStage.deleteMany({
            where: { templateId: template.id }
        });

        // 3. Get process types
        const procesos = await prisma.processType.findMany();
        const procesoMezcla = procesos.find(p => p.name.includes('Mezcla'));
        const procesoEsferificacion = procesos.find(p => p.name.includes('Esferificación'));
        const procesoEnvasado = procesos.find(p => p.name.includes('Envasado'));

        // 4. Get products
        const base = await prisma.product.findFirst({ where: { sku: 'PROCELIQUIPOPS01' } });
        const jarabe = await prisma.product.findFirst({ where: { name: { contains: 'Jarabe Fresa' } } });

        // Get some example ingredients for the jarabe (you can adjust these)
        const azucar = await prisma.product.findFirst({ where: { name: { contains: 'Azúcar' } } });
        const agua = await prisma.product.findFirst({ where: { name: { contains: 'Agua' } } });

        console.log('\nCreating 3 stages...');

        // Stage 1: Create Base (output: BASE LIQUIPOPS)
        if (base && procesoMezcla) {
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

            // Add inputs for base (example: maybe some powders or ingredients)
            // For now, we'll leave it without inputs as it might be a mixing of base ingredients
            console.log('✅ Stage 1: Crear Base');
        }

        // Stage 2: Prepare Jarabe (output: Jarabe Fresa)
        if (jarabe && procesoEsferificacion) {
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

            // Add inputs for jarabe (example ingredients)
            if (azucar) {
                await prisma.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage2.id,
                        inputType: 'MATERIAL',
                        productId: azucar.id,
                        quantityPerUnit: 50,
                        unit: 'GRAMOS',
                        displayOrder: 1
                    }
                });
            }

            if (agua) {
                await prisma.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage2.id,
                        inputType: 'MATERIAL',
                        productId: agua.id,
                        quantityPerUnit: 100,
                        unit: 'ML',
                        displayOrder: 2
                    }
                });
            }

            console.log('✅ Stage 2: Preparar Jarabe');
        }

        // Stage 3: Envasado Final (output: LIQD01)
        if (procesoEnvasado) {
            const stage3 = await prisma.assemblyTemplateStage.create({
                data: {
                    templateId: template.id,
                    stageOrder: 3,
                    stageName: 'Envasado 350g',
                    processTypeId: procesoEnvasado.id,
                    outputProductId: liqd01.id,
                    outputClassification: 'PRODUCTO_TERMINADO'
                }
            });

            // Inputs: Base (from stage 1) + Jarabe (from stage 2)
            if (base) {
                await prisma.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage3.id,
                        inputType: 'INTERMEDIATE',
                        productId: base.id,
                        fromStageOrder: 1,
                        quantityPerUnit: 250,
                        unit: 'GRAMOS',
                        displayOrder: 1
                    }
                });
            }

            if (jarabe) {
                await prisma.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage3.id,
                        inputType: 'INTERMEDIATE',
                        productId: jarabe.id,
                        fromStageOrder: 2,
                        quantityPerUnit: 100,
                        unit: 'ML',
                        displayOrder: 2
                    }
                });
            }

            console.log('✅ Stage 3: Envasado');
        }

        // 5. Update template totalStages
        await prisma.assemblyTemplate.update({
            where: { id: template.id },
            data: { totalStages: 3 }
        });

        console.log('\n🎉 Template updated successfully with 3 stages!');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
})();
