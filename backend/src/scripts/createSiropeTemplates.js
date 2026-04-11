const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🏭 Iniciando Migración a Plantillas Planas de Siropes...\n');

    // Mapear ProcessTypes
    const processTypes = await prisma.processType.findMany({
        where: { code: { in: ['G_PESAJE', 'CONTEO', 'G_EMPAQUE', 'G_ENSAMBLE'] } },
        select: { id: true, code: true }
    });
    const ptMap = {};
    processTypes.forEach(pt => { ptMap[pt.code] = pt.id; });
    const required = ['G_PESAJE', 'CONTEO', 'G_EMPAQUE', 'G_ENSAMBLE'];
    for (const code of required) {
        if (!ptMap[code]) throw new Error(`ProcessType ${code} no encontrado`);
    }

    // Identificar todos los sabores de siropes buscando por los productos finales
    // Los productos finales empiezan con "SIROPE GENIALITY SABOR A"
    const finishedProducts = await prisma.product.findMany({
        where: { name: { startsWith: 'SIROPE GENIALITY SABOR A' }, active: true }
    });

    // Agrupar por sabor
    const flavorGroups = {};
    for (const product of finishedProducts) {
        // Sacar sabor:
        // ej. "SIROPE GENIALITY SABOR A TAMARINDO X 360 ML" -> "TAMARINDO"
        const match = product.name.match(/SABOR A (.+?) X (\d+)\s*ML/);
        if (match) {
            const flavor = match[1].trim();
            const size = match[2];
            if (!flavorGroups[flavor]) flavorGroups[flavor] = { flavor, products: [] };
            flavorGroups[flavor].products.push({ id: product.id, size, name: product.name });
        }
    }

    console.log(`Detectados ${Object.keys(flavorGroups).length} sabores de siropes.`);

    // Obtener Inputs de la Base Clásica (TMPL064, Stage 1)
    const baseTmpl = await prisma.assemblyTemplate.findFirst({
        where: { templateCode: 'TMPL064' },
        include: { stages: { include: { inputs: true }, orderBy: { stageOrder: 'asc' } } }
    });
    const baseInputs = baseTmpl.stages[0].inputs.map(i => ({
        productId: i.productId,
        quantityPerUnit: i.quantityPerUnit,
        unit: i.unit,
        displayOrder: i.displayOrder
    }));

    // El ID del producto BATCH GENIALITY para salida
    const batchProduct = await prisma.product.findFirst({ where: { name: 'BATCH GENIALITY' } });

    for (const flavor of Object.keys(flavorGroups)) {
        await prisma.$transaction(async (tx) => {
            const tmplCode = `GTPL-${flavor.replace(/\s+/g, '-').toUpperCase()}`;
            console.log(`\nCreando ${tmplCode} ...`);

            // Eliminar si ya existe para reescribirlo limpio
            await tx.assemblyTemplateStageInput.deleteMany({
                where: { stage: { template: { templateCode: tmplCode } } }
            });
            await tx.assemblyTemplateStage.deleteMany({
                where: { template: { templateCode: tmplCode } }
            });
            await tx.assemblyTemplate.deleteMany({
                where: { templateCode: tmplCode }
            });

            const targetProductId = flavorGroups[flavor].products[0].id;
            const maxVersionTemplate = await tx.assemblyTemplate.findFirst({
                where: { productId: targetProductId },
                orderBy: { version: 'desc' }
            });
            const newVersion = (maxVersionTemplate?.version || 0) + 1;

            const template = await tx.assemblyTemplate.create({
                data: {
                    templateCode: tmplCode,
                    templateName: `Sirope ${flavor} (Plantilla Plana)`,
                    productId: targetProductId,
                    version: newVersion,
                    totalStages: 3 + (flavorGroups[flavor].products.length * 2),
                    description: `Proceso consolidado (Base + Saborización + Empaque + Ensamble) para ${flavor}`,
                    isActive: true,
                }
            });

            // ── Stage 1: G_PESAJE (Base Sirope) ──
            const stage1 = await tx.assemblyTemplateStage.create({
                data: {
                    templateId: template.id,
                    stageOrder: 1,
                    stageName: 'Base Sirope Clásica',
                    processTypeId: ptMap['G_PESAJE'],
                    processParameters: {
                        instruction: 'Pese y mezcle los ingredientes de la base sirope clásica.'
                    }
                }
            });
            for (const input of baseInputs) {
                await tx.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage1.id,
                        inputType: 'RAW_MATERIAL',
                        productId: input.productId,
                        quantityPerUnit: input.quantityPerUnit,
                        unit: input.unit,
                        displayOrder: input.displayOrder
                    }
                });
            }

            // ── Stage 2: G_PESAJE (Saborización) ──
            // Buscar la plantilla de Saborizacion correspondiente, e.g. "SABORIZACION TAMARINDO"
            const sabProduct = await tx.product.findFirst({ where: { name: `SABORIZACION ${flavor}` } });
            let sabInputs = [];
            if (sabProduct) {
                const sabTmpl = await tx.assemblyTemplate.findFirst({
                    where: { productId: sabProduct.id, isActive: true },
                    include: { stages: { include: { inputs: true }, orderBy: { stageOrder: 'asc' } } }
                });
                if (sabTmpl && sabTmpl.stages.length > 0) {
                    sabInputs = sabTmpl.stages[0].inputs
                        .filter(i => {
                            // SKIP the BASE SIROPE CLASICA dependency because we are doing it flat
                            return i.productId !== baseTmpl.productId;
                        })
                        .map(i => ({
                            productId: i.productId,
                            quantityPerUnit: i.quantityPerUnit,
                            unit: i.unit,
                            displayOrder: i.displayOrder
                        }));
                }
            } else {
                console.warn(`  ⚠️ No se encontró producto de Saborización para ${flavor}`);
            }

            const stage2 = await tx.assemblyTemplateStage.create({
                data: {
                    templateId: template.id,
                    stageOrder: 2,
                    stageName: `Saborización ${flavor}`,
                    processTypeId: ptMap['G_PESAJE'],
                    processParameters: {
                        instruction: `Agregue los componentes de sabor para ${flavor}.`
                    }
                }
            });
            for (const input of sabInputs) {
                await tx.assemblyTemplateStageInput.create({
                    data: {
                        stageId: stage2.id,
                        inputType: 'RAW_MATERIAL',
                        productId: input.productId,
                        quantityPerUnit: input.quantityPerUnit,
                        unit: input.unit,
                        displayOrder: input.displayOrder
                    }
                });
            }

            // ── Stage 3: CONTEO ──
            const stage3 = await tx.assemblyTemplateStage.create({
                data: {
                    templateId: template.id,
                    stageOrder: 3,
                    stageName: 'Conteo de Producción por Referencia',
                    processTypeId: ptMap['CONTEO'],
                    processParameters: {
                        instruction: 'Cuente las unidades de sirope envasadas.'
                    }
                }
            });

            // ── Stages 4+: G_EMPAQUE y G_ENSAMBLE para cada tamaño (360ML, 1000ML) ──
            let currentOrder = 4;
            const prods = flavorGroups[flavor].products;
            
            // Traer las reglas de empaque desde TMPL096 (1000ML) y TMPL097 (360ML)
            const templateCache = {};
            
            for (const p of prods) {
                // Determine source template
                const sourceTemplate = await tx.assemblyTemplate.findFirst({
                    where: { productId: p.id, isActive: true },
                    include: { stages: { include: { inputs: true }, orderBy: { stageOrder: 'asc' } } }
                });
                
                let empaqueInputs = [];
                if (sourceTemplate) {
                    const empStage = sourceTemplate.stages.find(s => s.processTypeId === ptMap['G_EMPAQUE'] || s.stageName.includes('Empaque'));
                    if (empStage) {
                        empaqueInputs = empStage.inputs.map(i => ({
                            productId: i.productId,
                            quantityPerUnit: i.quantityPerUnit,
                            unit: i.unit,
                            displayOrder: i.displayOrder
                        }));
                    }
                }

                // EMPAQUE
                const stgEmp = await tx.assemblyTemplateStage.create({
                    data: {
                        templateId: template.id,
                        stageOrder: currentOrder++,
                        stageName: `Empaque de SIROPE GENIALITY SABOR A ${flavor} X ${p.size} ML`,
                        processTypeId: ptMap['G_EMPAQUE'],
                        outputProductId: p.id,
                        outputClassification: 'FINISHED_GOOD',
                        processParameters: { instruction: `Empaque por carritos tamaño ${p.size} ML.` }
                    }
                });
                for (const input of empaqueInputs) {
                    await tx.assemblyTemplateStageInput.create({
                        data: {
                            stageId: stgEmp.id,
                            inputType: 'RAW_MATERIAL',
                            productId: input.productId,
                            quantityPerUnit: input.quantityPerUnit,
                            unit: input.unit,
                            displayOrder: input.displayOrder
                        }
                    });
                }

                // ENSAMBLE
                const stgEns = await tx.assemblyTemplateStage.create({
                    data: {
                        templateId: template.id,
                        stageOrder: currentOrder++,
                        stageName: `Ensamble Siigo de SIROPE GENIALITY SABOR A ${flavor} X ${p.size} ML`,
                        processTypeId: ptMap['G_ENSAMBLE'],
                        outputProductId: p.id,
                        outputClassification: 'FINISHED_GOOD',
                        processParameters: { instruction: `Registrar la nota de ensamble en Siigo para ${p.size} ML.` }
                    }
                });
            }
            console.log(`  Listo ${tmplCode} con ${currentOrder - 1} etapas.`);
        });
    }

    console.log('\n✅ Proceso completado.');
}

main()
    .catch(e => { console.error('❌ Error:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
