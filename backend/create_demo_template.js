const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
    try {
        // Find the LIQD01 product
        const product = await prisma.product.findFirst({
            where: { sku: 'LIQD01' }
        });

        if (!product) {
            console.log('❌ Producto LIQD01 no encontrado');
            await prisma.$disconnect();
            return;
        }

        console.log(`✅ Producto encontrado: ${product.name}`);

        // Check if template already exists
        const existing = await prisma.assemblyTemplate.findFirst({
            where: { productId: product.id }
        });

        if (existing) {
            console.log('⚠️ Ya existe una plantilla para este producto');
            await prisma.$disconnect();
            return;
        }

        // Get base and jarabe products
        const base = await prisma.product.findFirst({ where: { sku: 'PROCELIQUIPOPS01' } });
        const jarabe = await prisma.product.findFirst({ where: { name: { contains: 'Jarabe Fresa' } } });

        // Get process types
        const procesos = await prisma.processType.findMany();
        const procesoEnvasado = procesos.find(p => p.name.includes('Envasado'));
        const procesoEsferificacion = procesos.find(p => p.name.includes('Esferificación'));

        console.log('Creando plantilla demo...');

        // Create template
        const template = await prisma.assemblyTemplate.create({
            data: {
                templateCode: 'DEMO-FRES-350',
                templateName: 'Demo Liquipops Fresa 350g',
                productId: product.id,
                version: 1,
                totalStages: 2,
                isActive: true,
                description: 'Plantilla demo generada automáticamente'
            }
        });

        console.log(`✅ Plantilla creada: ${template.id}`);

        // Stage 1: Preparar Jarabe (if we have it)
        if (jarabe && procesoEsferificacion) {
            await prisma.assemblyTemplateStage.create({
                data: {
                    templateId: template.id,
                    stageOrder: 1,
                    stageName: 'Preparar Jarabe Fresa',
                    processTypeId: procesoEsferificacion.id,
                    outputProductId: jarabe.id,
                    outputClassification: 'SEMITERMINADO'
                }
            });
            console.log('✅ Etapa 1 creada: Preparar Jarabe');
        }

        // Stage 2: Envasado Final
        if (procesoEnvasado) {
            const stage2 = await prisma.assemblyTemplateStage.create({
                data: {
                    templateId: template.id,
                    stageOrder: 2,
                    stageName: 'Envasado 350g',
                    processTypeId: procesoEnvasado.id,
                    outputProductId: product.id,
                    outputClassification: 'PRODUCTO_TERMINADO'
                }
            });

            // Add inputs
            if (base) {
                await prisma.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage2.id,
                        inputType: 'MATERIAL',
                        productId: base.id,
                        quantityPerUnit: 350,
                        unit: 'GRAMOS',
                        displayOrder: 1
                    }
                });
            }

            if (jarabe) {
                await prisma.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage2.id,
                        inputType: 'INTERMEDIATE',
                        productId: jarabe.id,
                        fromStageOrder: 1,
                        quantityPerUnit: 100,
                        unit: 'ML',
                        displayOrder: 2
                    }
                });
            }

            console.log('✅ Etapa 2 creada: Envasado');
        }

        console.log('\n🎉 Plantilla demo completada para LIQD01');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
})();
