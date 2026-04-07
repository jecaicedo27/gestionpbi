/**
 * createEscarchadoTemplate.js
 *
 * Crea la Plantilla de Producción para BASE ESCARCHADOR con 5 etapas:
 *   1. GE_PREMIX      — Premix Seco (almidones, goma, azúcar, sucralosa)
 *   2. GE_BASE_LIQUIDA — Base Líquida + Incorporación 20 min (azúcar invertida + agua)
 *   3. GE_COCCION      — Cocción 65°C → Enfriamiento 45°C (sorbato) → 40°C
 *   4. G_EMPAQUE       — Empaque (carriots) — REUTILIZA el processType existente
 *   5. G_ENSAMBLE      — Nota Siigo ensamble — REUTILIZA el processType existente
 *
 * Datos fuente:
 *   Fórmula FORM135 | Producto BASE ESCARCHADOR
 *   ProductId: 6c90814c-2b7e-4865-abc1-88721e22a1db
 *
 * Uso: node backend/src/scripts/createEscarchadoTemplate.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── IDs de referencia (obtenidos de la BD) ─────────────────────────────────
const BASE_ESCARCHADOR_PRODUCT_ID = '6c90814c-2b7e-4865-abc1-88721e22a1db';

// Productos finales (presentaciones del sirope escarchador)
const SIROPE_1000ML_ID = 'e190b466-de48-4f41-a90b-b0fb0f88f56b';
const SIROPE_360ML_ID  = 'fc512899-ed81-4dd8-8e91-eae8d8798630';

// Ingredientes (de FORM135)
const ING = {
    azucarInvertida:  '4219f45c-acf5-4e56-ad9b-162bad08e39f',  // 85,000g — base líquida
    agua:             'd4d4e32a-5d35-40a0-bbbe-e78e93ba5dca',  // 7,800g  — base líquida
    almidонCream:     '200581d1-440a-4d13-b38b-32575c87923e',  // 800g    — premix
    almidонThin:      '21f5f328-88e9-42ab-bf87-2436e9731e0d',  // 600g    — premix
    gomaXhantana:     '345d5b6c-3976-4676-8b5b-0b15df7ed891',  // 260g    — premix
    azucar:           'ab09b25f-51f7-4f16-ad8e-067ccf798841',  // 7,000g  — premix
    sorbato:          '6f770e08-a341-4876-873e-66032b5b1ff2',  // 43g     — cocción
    sucralosa:        'f7c4a364-4e9d-4b41-a878-d3da9a68f7e4',  // 20g     — premix
};

async function main() {
    console.log('🏭 Creando Plantilla Escarchado...\n');

    // Verificar que no existe ya
    const existing = await prisma.assemblyTemplate.findFirst({
        where: { templateCode: 'GTPL-ESCARCHADO-v1' }
    });
    if (existing) {
        console.log('⚠️  La plantilla GTPL-ESCARCHADO-v1 ya existe. ID:', existing.id);
        console.log('   Si quieres recrearla, elimina primero el registro.');
        return;
    }

    // Obtener IDs de processTypes
    const processTypes = await prisma.processType.findMany({
        where: { code: { in: ['GE_PREMIX', 'GE_BASE_LIQUIDA', 'GE_COCCION', 'G_EMPAQUE', 'G_ENSAMBLE'] } },
        select: { id: true, code: true }
    });

    const ptMap = {};
    processTypes.forEach(pt => { ptMap[pt.code] = pt.id; });

    const required = ['GE_PREMIX', 'GE_BASE_LIQUIDA', 'GE_COCCION', 'G_EMPAQUE', 'G_ENSAMBLE'];
    for (const code of required) {
        if (!ptMap[code]) throw new Error(`ProcessType ${code} no encontrado en BD`);
    }

    console.log('✅ ProcessTypes encontrados:', Object.keys(ptMap).join(', '));

    // ── Crear plantilla en transacción ─────────────────────────────────────
    const template = await prisma.$transaction(async (tx) => {

        const newTemplate = await tx.assemblyTemplate.create({
            data: {
                templateCode:  'GTPL-ESCARCHADO-v1',
                templateName:  'Plantilla Escarchado Geniality v1',
                productId:     BASE_ESCARCHADOR_PRODUCT_ID,
                version:       1,
                totalStages:   5,
                description:   'Proceso de producción Escarchado: premix seco + base líquida + cocción/enfriamiento + empaque + ensamble Siigo.',
                isActive:      true,
            }
        });

        console.log('   Plantilla header creada:', newTemplate.id);

        // ── Stage 1: GE_PREMIX ──────────────────────────────────────────────
        const stage1 = await tx.assemblyTemplateStage.create({
            data: {
                templateId:    newTemplate.id,
                stageOrder:    1,
                stageName:     'Premix Seco — Escarchado',
                processTypeId: ptMap['GE_PREMIX'],
                processParameters: {
                    instruction: 'Pese y mezcle los ingredientes secos hasta obtener distribución homogénea.',
                },
                specialInstructions: 'Mezclar en este orden: almidones → goma xantana → azúcar → sucralosa.',
            }
        });

        // Inputs premix: almidón Cream, almidón Thin, goma xantana, azúcar, sucralosa
        const premixInputs = [
            { ingredientId: ING.almidонCream,   qty: 800,   name: 'ALMIDON POLTEC GEL CREAM' },
            { ingredientId: ING.almidонThin,    qty: 600,   name: 'ALMIDON POLTEC GEL THIN' },
            { ingredientId: ING.gomaXhantana,   qty: 260,   name: 'GOMA XHANTANA' },
            { ingredientId: ING.azucar,         qty: 7000,  name: 'AZUCAR' },
            { ingredientId: ING.sucralosa,      qty: 20,    name: 'SUCRALOSA' },
        ];

        for (let i = 0; i < premixInputs.length; i++) {
            await tx.assemblyTemplateStageInput.create({
                data: {
                    stageId:         stage1.id,
                    inputType:       'RAW_MATERIAL',
                    productId:       premixInputs[i].ingredientId,
                    quantityPerUnit: premixInputs[i].qty,
                    unit:            'g',
                    displayOrder:    i + 1,
                }
            });
        }
        console.log('   Stage 1 (GE_PREMIX) creado con', premixInputs.length, 'inputs');

        // ── Stage 2: GE_BASE_LIQUIDA ────────────────────────────────────────
        const stage2 = await tx.assemblyTemplateStage.create({
            data: {
                templateId:    newTemplate.id,
                stageOrder:    2,
                stageName:     'Base Líquida + Incorporación — Escarchado',
                processTypeId: ptMap['GE_BASE_LIQUIDA'],
                processParameters: {
                    instruction:    'Agregue azúcar invertida y agua a la máquina. Encienda agitación y recirculación. Incorpore gradualmente el premix seco.',
                    time_minutes:   20,
                },
                specialInstructions: 'Mantener agitación y recirculación durante 20 minutos para correcta dispersión.',
            }
        });

        const baseInputs = [
            { ingredientId: ING.azucarInvertida, qty: 85000, name: 'AZUCAR INVERTIDA FRUCTOSA' },
            { ingredientId: ING.agua,            qty: 7800,  name: 'AGUA' },
        ];

        for (let i = 0; i < baseInputs.length; i++) {
            await tx.assemblyTemplateStageInput.create({
                data: {
                    stageId:         stage2.id,
                    inputType:       'RAW_MATERIAL',
                    productId:       baseInputs[i].ingredientId,
                    quantityPerUnit: baseInputs[i].qty,
                    unit:            'g',
                    displayOrder:    i + 1,
                }
            });
        }
        console.log('   Stage 2 (GE_BASE_LIQUIDA) creado con', baseInputs.length, 'inputs');

        // ── Stage 3: GE_COCCION ─────────────────────────────────────────────
        const stage3 = await tx.assemblyTemplateStage.create({
            data: {
                templateId:    newTemplate.id,
                stageOrder:    3,
                stageName:     'Cocción y Enfriamiento — Escarchado',
                processTypeId: ptMap['GE_COCCION'],
                processParameters: {
                    instruction:   'Calentar a 65°C → Enfriar a 45°C y agregar sorbato de potasio → Enfriar a 40°C (listo para envasar).',
                    checkpoints: [
                        { temp: 65, label: 'Calentamiento', action: null },
                        { temp: 45, label: 'Primer Enfriamiento', action: 'Agregar 43g sorbato de potasio' },
                        { temp: 40, label: 'Enfriamiento Final', action: null },
                    ],
                },
                outputProductId: BASE_ESCARCHADOR_PRODUCT_ID,
                specialInstructions: 'Asegurar completa disolución del sorbato de potasio mediante agitación a 45°C.',
            }
        });

        // Input cocción: sorbato de potasio (se agrega en el proceso)
        await tx.assemblyTemplateStageInput.create({
            data: {
                stageId:         stage3.id,
                inputType:       'RAW_MATERIAL',
                productId:       ING.sorbato,
                quantityPerUnit: 43,
                unit:            'g',
                displayOrder:    1,
            }
        });
        console.log('   Stage 3 (GE_COCCION) creado con 1 input (sorbato de potasio)');

        // ── Stage 4: G_EMPAQUE ──────────────────────────────────────────────
        const stage4 = await tx.assemblyTemplateStage.create({
            data: {
                templateId:    newTemplate.id,
                stageOrder:    4,
                stageName:     'Empaque Sirope Escarchado',
                processTypeId: ptMap['G_EMPAQUE'],
                processParameters: {
                    instruction: 'Envasar el sirope escarchado en presentaciones 360ml y 1000ml mediante sistema de carriots.',
                },
                outputProductId: SIROPE_360ML_ID,   // Presentación principal
                outputClassification: 'FINISHED_GOOD',
                specialInstructions: 'Verificar sello hermético. Revisar apariencia del escarchado en el producto terminado.',
            }
        });
        console.log('   Stage 4 (G_EMPAQUE) creado');

        // ── Stage 5: G_ENSAMBLE ─────────────────────────────────────────────
        const stage5 = await tx.assemblyTemplateStage.create({
            data: {
                templateId:    newTemplate.id,
                stageOrder:    5,
                stageName:     'Ensamble Siigo — Escarchado',
                processTypeId: ptMap['G_ENSAMBLE'],
                processParameters: {
                    instruction: 'Registrar la nota de ensamble en Siigo para el sirope escarchador.',
                },
                outputProductId: SIROPE_360ML_ID,
                outputClassification: 'FINISHED_GOOD',
            }
        });
        console.log('   Stage 5 (G_ENSAMBLE) creado');

        return await tx.assemblyTemplate.findUnique({
            where: { id: newTemplate.id },
            include: {
                stages: {
                    include: { processType: true, inputs: { include: { product: { select: { id: true, name: true } } } } },
                    orderBy: { stageOrder: 'asc' }
                }
            }
        });
    });

    // ── Resumen ─────────────────────────────────────────────────────────────
    console.log('\n✅ Plantilla creada exitosamente:');
    console.log('   ID:', template.id);
    console.log('   Código:', template.templateCode);
    console.log('   Nombre:', template.templateName);
    console.log('\n📋 Etapas:');
    template.stages.forEach(s => {
        console.log(`   ${s.stageOrder}. [${s.processType.code}] ${s.stageName}`);
        s.inputs.forEach(inp => console.log(`      → ${inp.product?.name || inp.productId} — ${inp.quantityPerUnit}${inp.unit}`));
    });
}

main()
    .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
