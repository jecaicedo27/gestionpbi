/**
 * Create the BATCH LIQUIPOPS master template with flavor-dependent stages.
 * 
 * Flow:
 * 1. 📋 BASE LIQUIPOPS (sub-template, fixed)
 * 2. 📋 COMPUESTO {SABOR} (sub-template, flavor-dependent — uses FRESA as default)
 * 3. Formación de Esferas {SABOR} (flavor-dependent output)
 * 4. Conteo de Tarros (fixed)
 * 5. Empaque 3400g (flavor-dependent product)
 * 6. Empaque 1150g (flavor-dependent product)
 * 7. Empaque 350g (flavor-dependent product)
 * 8. Ensamble Siigo 3400g (flavor-dependent product)
 * 9. Ensamble Siigo 1150g (flavor-dependent product)
 * 10. Ensamble Siigo 350g (flavor-dependent product)
 * 
 * NO Protección (prepared separately for the whole day)
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Get BATCH LIQUIPOPS product
    const batchProduct = await prisma.product.findFirst({
        where: { sku: 'PROCELIQUIPOPS52' }
    });
    if (!batchProduct) throw new Error('BATCH LIQUIPOPS product not found (PROCELIQUIPOPS52)');
    console.log(`✅ Product: ${batchProduct.name} (${batchProduct.id})`);

    // Get sub-template IDs
    const baseLiqTemplate = await prisma.assemblyTemplate.findFirst({
        where: { templateCode: 'TMPL-BASELIQ-001' }
    });
    const compuestoFresaTemplate = await prisma.assemblyTemplate.findFirst({
        where: { templateCode: 'TMPL008' }
    });
    if (!baseLiqTemplate) throw new Error('BASE LIQUIPOPS template not found');
    if (!compuestoFresaTemplate) throw new Error('COMPUESTO FRESA template not found');

    // Get process type IDs from MASTER-FRESA
    const masterFresa = await prisma.assemblyTemplate.findFirst({
        where: { templateCode: 'MASTER-FRESA' },
        include: {
            stages: {
                include: { processType: true },
                orderBy: { stageOrder: 'asc' }
            }
        }
    });
    if (!masterFresa) throw new Error('MASTER-FRESA template not found');

    // Extract process type IDs from MASTER-FRESA stages
    const processTypeMap = {};
    for (const stage of masterFresa.stages) {
        processTypeMap[stage.processType.name] = stage.processTypeId;
    }
    console.log('Process types:', Object.keys(processTypeMap));

    // Get FRESA product IDs for default (will be overridden by flavor resolution)
    const esferasFresa = await prisma.product.findFirst({
        where: { name: { contains: 'ESFERAS FRESA', mode: 'insensitive' } }
    });

    // Get FRESA empaque products (3400g, 1150g, 350g)
    const fresa3400 = await prisma.product.findFirst({
        where: { name: { contains: 'LIQUIPOPS SABOR A FRESA X 3400', mode: 'insensitive' }, NOT: { name: { contains: 'ETIQUETA' } } }
    });
    const fresa1150 = await prisma.product.findFirst({
        where: { name: { contains: 'LIQUIPOPS SABOR A FRESA X 1150', mode: 'insensitive' }, NOT: { name: { contains: 'ETIQUETA' } } }
    });
    const fresa350 = await prisma.product.findFirst({
        where: { name: { contains: 'LIQUIPOPS SABOR A FRESA X 350', mode: 'insensitive' }, NOT: { name: { contains: 'ETIQUETA' } } }
    });

    console.log(`Default FRESA products: 3400=${fresa3400?.name}, 1150=${fresa1150?.name}, 350=${fresa350?.name}`);

    // Check if template already exists
    const existing = await prisma.assemblyTemplate.findFirst({
        where: { templateCode: 'BATCH-LIQUIPOPS' }
    });
    if (existing) {
        console.log('⚠️  BATCH-LIQUIPOPS already exists. Deleting and recreating...');
        // Delete stages and inputs first
        const stages = await prisma.assemblyTemplateStage.findMany({ where: { templateId: existing.id } });
        for (const s of stages) {
            await prisma.assemblyTemplateStageInput.deleteMany({ where: { stageId: s.id } });
        }
        await prisma.assemblyTemplateStage.deleteMany({ where: { templateId: existing.id } });
        await prisma.assemblyTemplate.delete({ where: { id: existing.id } });
    }

    // Create the template
    const template = await prisma.assemblyTemplate.create({
        data: {
            templateCode: 'BATCH-LIQUIPOPS',
            templateName: 'Batch LIQUIPOPS (Genérico)',
            productId: batchProduct.id,
            description: 'Plantilla maestra genérica para producción de LIQUIPOPS. El sabor se resuelve dinámicamente al iniciar el batch.',
            isActive: true,
            totalStages: 10,
            stages: {
                create: [
                    // 1. BASE LIQUIPOPS (sub-template)
                    {
                        stageOrder: 1,
                        stageName: '📋 BASE LIQUIPOPS',
                        processTypeId: processTypeMap['Pesaje'],
                        subTemplateId: baseLiqTemplate.id,
                        outputClassification: 'PRODUCTO_EN_PROCESO',
                        processParameters: {}
                    },
                    // 2. COMPUESTO {SABOR} (sub-template, flavor-dependent)
                    {
                        stageOrder: 2,
                        stageName: '📋 COMPUESTO {SABOR}',
                        processTypeId: processTypeMap['Pesaje'],
                        subTemplateId: compuestoFresaTemplate.id, // Default: FRESA
                        outputClassification: 'PRODUCTO_EN_PROCESO',
                        processParameters: {
                            flavorDependent: true,
                            flavorRole: 'compuesto'
                        }
                    },
                    // 3. Formación de Esferas (flavor-dependent output)
                    {
                        stageOrder: 3,
                        stageName: 'Formación de Esferas {SABOR}',
                        processTypeId: processTypeMap['Formación de Esferas'],
                        outputProductId: esferasFresa?.id || null,
                        outputClassification: 'SEMI_FINISHED',
                        processParameters: {
                            flavorDependent: true,
                            flavorRole: 'esferificacion'
                        }
                    },
                    // 4. Conteo de Tarros
                    {
                        stageOrder: 4,
                        stageName: 'Conteo de Tarros por Referencia',
                        processTypeId: processTypeMap['Conteo'],
                        outputClassification: 'PRODUCTO_EN_PROCESO',
                        processParameters: {}
                    },
                    // 5. Empaque 3400g (flavor-dependent)
                    {
                        stageOrder: 5,
                        stageName: 'Empaque LIQUIPOPS {SABOR} 3400g',
                        processTypeId: processTypeMap['Empaque'],
                        outputProductId: fresa3400?.id || null,
                        processParameters: {
                            flavorDependent: true,
                            flavorRole: 'empaque_3400',
                            product_id: fresa3400?.id || null
                        }
                    },
                    // 6. Empaque 1150g (flavor-dependent)
                    {
                        stageOrder: 6,
                        stageName: 'Empaque LIQUIPOPS {SABOR} 1150g',
                        processTypeId: processTypeMap['Empaque'],
                        outputProductId: fresa1150?.id || null,
                        processParameters: {
                            flavorDependent: true,
                            flavorRole: 'empaque_1150',
                            product_id: fresa1150?.id || null
                        }
                    },
                    // 7. Empaque 350g (flavor-dependent)
                    {
                        stageOrder: 7,
                        stageName: 'Empaque LIQUIPOPS {SABOR} 350g',
                        processTypeId: processTypeMap['Empaque'],
                        outputProductId: fresa350?.id || null,
                        processParameters: {
                            flavorDependent: true,
                            flavorRole: 'empaque_350',
                            product_id: fresa350?.id || null
                        }
                    },
                    // 8. Ensamble Siigo 3400g (flavor-dependent)
                    {
                        stageOrder: 8,
                        stageName: 'Ensamble Siigo LIQUIPOPS {SABOR} 3400g',
                        processTypeId: processTypeMap['Ensamble Siigo'],
                        outputProductId: fresa3400?.id || null,
                        outputClassification: 'FINISHED_GOOD',
                        processParameters: {
                            flavorDependent: true,
                            flavorRole: 'ensamble_3400'
                        }
                    },
                    // 9. Ensamble Siigo 1150g (flavor-dependent)
                    {
                        stageOrder: 9,
                        stageName: 'Ensamble Siigo LIQUIPOPS {SABOR} 1150g',
                        processTypeId: processTypeMap['Ensamble Siigo'],
                        outputProductId: fresa1150?.id || null,
                        outputClassification: 'FINISHED_GOOD',
                        processParameters: {
                            flavorDependent: true,
                            flavorRole: 'ensamble_1150'
                        }
                    },
                    // 10. Ensamble Siigo 350g (flavor-dependent)
                    {
                        stageOrder: 10,
                        stageName: 'Ensamble Siigo LIQUIPOPS {SABOR} 350g',
                        processTypeId: processTypeMap['Ensamble Siigo'],
                        outputProductId: fresa350?.id || null,
                        outputClassification: 'FINISHED_GOOD',
                        processParameters: {
                            flavorDependent: true,
                            flavorRole: 'ensamble_350'
                        }
                    }
                ]
            }
        },
        include: {
            stages: { orderBy: { stageOrder: 'asc' } }
        }
    });

    console.log(`\n✅ Template created: ${template.templateCode} (${template.id})`);
    console.log(`   Product: ${batchProduct.name}`);
    console.log(`   Stages: ${template.stages.length}`);
    template.stages.forEach(s => {
        const flags = s.processParameters?.flavorDependent ? ' 🔄' : '';
        const sub = s.subTemplateId ? ` [sub: ${s.subTemplateId.slice(0, 8)}]` : '';
        console.log(`   ${s.stageOrder}. ${s.stageName}${flags}${sub}`);
    });
}

main()
    .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
