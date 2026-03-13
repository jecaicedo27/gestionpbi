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

        // Delete old notes too
        await prisma.assemblyNote.deleteMany({
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

        // Find or create "Esferas Fresa" product (intermediate)
        let esferas = await prisma.product.findFirst({ where: { name: { contains: 'Esferas Fresa' } } });
        if (!esferas) {
            // Create it if it doesn't exist
            const grupo = await prisma.inventoryGroup.findFirst({ where: { name: 'LIQUIPOPS' } });
            esferas = await prisma.product.create({
                data: {
                    name: 'Esferas Fresa (Intermedio)',
                    sku: 'INT-ESF-FRESA',
                    groupId: grupo?.id,
                    classification: 'SEMITERMINADO',
                    currentStock: 0
                }
            });
            console.log('Created intermediate product: Esferas Fresa');
        }

        // Get example ingredients
        const azucar = await prisma.product.findFirst({ where: { name: { contains: 'Azúcar' } } });
        const agua = await prisma.product.findFirst({ where: { name: { contains: 'Agua' } } });

        console.log('\nCreating 4 stages...');

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

            // Add inputs for jarabe
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

        // Stage 3: Esferificación (output: Esferas Fresa)
        if (esferas && procesoEsferificacion) {
            const stage3 = await prisma.assemblyTemplateStage.create({
                data: {
                    templateId: template.id,
                    stageOrder: 3,
                    stageName: 'Esferificación',
                    processTypeId: procesoEsferificacion.id,
                    outputProductId: esferas.id,
                    outputClassification: 'SEMITERMINADO'
                }
            });

            // Input: Jarabe from stage 2
            if (jarabe) {
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
            }

            console.log('✅ Stage 3: Esferificación');
        }

        // Stage 4: Envasado Final (output: LIQD01)
        if (procesoEnvasado) {
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

            // Inputs: Base (from stage 1) + Esferas (from stage 3)
            if (base) {
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
            }

            if (esferas) {
                await prisma.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage4.id,
                        inputType: 'INTERMEDIATE',
                        productId: esferas.id,
                        fromStageOrder: 3,
                        quantityPerUnit: 100,
                        unit: 'GRAMOS',
                        displayOrder: 2
                    }
                });
            }

            console.log('✅ Stage 4: Envasado');
        }

        // 5. Update template totalStages
        await prisma.assemblyTemplate.update({
            where: { id: template.id },
            data: { totalStages: 4 }
        });

        console.log('\n🎉 Template updated successfully with 4 stages!');
        console.log('Flow: Base → Jarabe → Esferificación → Envasado');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
})();
