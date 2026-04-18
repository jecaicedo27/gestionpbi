/**
 * migrateEscarchadoFlow.js
 *
 * 1. Updates TMPL101 (BASE ESCARCHADOR):
 *    Replaces generic G_PESAJE + G_ENSAMBLE with specialized stages:
 *      GE_PREMIX → GE_BASE_LIQUIDA → GE_COCCION → G_ENSAMBLE
 *
 * 2. Creates BATCH-ESCARCHADOR umbrella template:
 *      Stage 1: sub-template → TMPL101 (BASE ESCARCHADOR)
 *      Stage 2: CONTEO
 *      Stage 3: sub-template → TMPL-ESC-1000 (Empaque + Ensamble Siigo)
 *      Stage 4: sub-template → TMPL-ESC-360  (Empaque + Ensamble Siigo)
 *
 * Safe: Does NOT touch BATCH-GENIALITY or any Liquipops templates.
 *
 * Usage: node backend/src/scripts/migrateEscarchadoFlow.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── IDs from database ─────────────────────────────────────────────────────
const TMPL101_ID = '6ceb5e4c-2153-46de-930b-c2ea3f6397ac';
const BASE_ESCARCHADOR_PRODUCT_ID = '6c90814c-2b7e-4865-abc1-88721e22a1db';

// ProcessType IDs
const PT = {
    GE_PREMIX:       'b23101b7-7cfa-49b8-af84-05e22a09c785',
    GE_BASE_LIQUIDA: 'c187106c-cd86-418b-b231-e92adce911cb',
    GE_COCCION:      'b21e7d3e-d62d-4bb7-a4b2-4417ebf1127c',
    G_ENSAMBLE:      '27d4499f-ad70-4bd6-be5f-b3b974ff03ea',
    CONTEO:          '646507ff-f327-44f9-bdaa-1d8655bcda04',
    G_PESAJE:        'bf423e44-3a95-4885-a79b-1e1fd17501ef',
};

// Sub-template IDs for umbrella
const TMPL_ESC_1000_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const TMPL_ESC_360_ID  = 'b1b2c3d4-e5f6-7890-abcd-ef1234567890';
const SIROPE_1000_PRODUCT_ID = 'e190b466-de48-4f41-a90b-b0fb0f88f56b';
const SIROPE_360_PRODUCT_ID  = 'fc512899-ed81-4dd8-8e91-eae8d8798630';

// Ingredient product IDs + proportional quantities (from current TMPL101)
const ING = {
    azucarInvertida: { id: '4219f45c-acf5-4e56-ad9b-162bad08e39f', qty: 0.8372487022645115 },
    agua:            { id: 'd4d4e32a-5d35-40a0-bbbe-e78e93ba5dca', qty: 0.07682988091368459 },
    almidonCream:    { id: '200581d1-440a-4d13-b38b-32575c87923e', qty: 0.007879987786018932 },
    almidonThin:     { id: '21f5f328-88e9-42ab-bf87-2436e9731e0d', qty: 0.005909990839514199 },
    gomaXhantana:    { id: '345d5b6c-3976-4676-8b5b-0b15df7ed891', qty: 0.002560996030456153 },
    azucar:          { id: 'ab09b25f-51f7-4f16-ad8e-067ccf798841', qty: 0.06894989312766565 },
    sorbato:         { id: '6f770e08-a341-4876-873e-66032b5b1ff2', qty: 0.0004235493434985176 },
    sucralosa:       { id: 'f7c4a364-4e9d-4b41-a878-d3da9a68f7e4', qty: 0.0001969996946504733 },
};

async function updateTMPL101() {
    console.log('━━━ STEP 1: Update TMPL101 (BASE ESCARCHADOR) ━━━\n');

    // Get current stages
    const currentStages = await prisma.assemblyTemplateStage.findMany({
        where: { templateId: TMPL101_ID },
        select: { id: true, stageOrder: true, stageName: true }
    });
    console.log('Current stages:', currentStages.map(s => `${s.stageOrder}. ${s.stageName}`).join(', '));

    await prisma.$transaction(async (tx) => {
        // Delete existing stage inputs first (FK constraint)
        for (const stage of currentStages) {
            await tx.assemblyTemplateStageInput.deleteMany({ where: { stageId: stage.id } });
        }
        // Delete existing stages
        await tx.assemblyTemplateStage.deleteMany({ where: { templateId: TMPL101_ID } });
        console.log('✅ Old stages deleted');

        // Update template totalStages
        await tx.assemblyTemplate.update({
            where: { id: TMPL101_ID },
            data: { totalStages: 4 }
        });

        // ── Stage 1: GE_PREMIX (premix seco) ────────────────────────
        const s1 = await tx.assemblyTemplateStage.create({
            data: {
                templateId: TMPL101_ID,
                stageOrder: 1,
                stageName: 'Premix Seco — Escarchado',
                processTypeId: PT.GE_PREMIX,
                processParameters: {
                    instruction: 'Pese y mezcle los ingredientes secos hasta obtener distribución homogénea.',
                },
                specialInstructions: 'Mezclar en orden: almidones → goma xantana → azúcar → sucralosa.',
            }
        });
        const premixInputs = [
            { productId: ING.almidonCream.id, qty: ING.almidonCream.qty, name: 'ALMIDON POLTEC GEL CREAM' },
            { productId: ING.almidonThin.id,  qty: ING.almidonThin.qty,  name: 'ALMIDON POLTEC GEL THIN' },
            { productId: ING.gomaXhantana.id, qty: ING.gomaXhantana.qty, name: 'GOMA XHANTANA' },
            { productId: ING.azucar.id,       qty: ING.azucar.qty,       name: 'AZUCAR' },
            { productId: ING.sucralosa.id,    qty: ING.sucralosa.qty,    name: 'SUCRALOSA' },
        ];
        for (let i = 0; i < premixInputs.length; i++) {
            await tx.assemblyTemplateStageInput.create({
                data: {
                    stageId: s1.id,
                    inputType: 'RAW_MATERIAL',
                    productId: premixInputs[i].productId,
                    quantityPerUnit: premixInputs[i].qty,
                    unit: 'gramo',
                    displayOrder: i + 1,
                }
            });
        }
        console.log('✅ Stage 1 (GE_PREMIX) created with', premixInputs.length, 'inputs');

        // ── Stage 2: GE_BASE_LIQUIDA ────────────────────────────────
        const s2 = await tx.assemblyTemplateStage.create({
            data: {
                templateId: TMPL101_ID,
                stageOrder: 2,
                stageName: 'Base Líquida + Incorporación — Escarchado',
                processTypeId: PT.GE_BASE_LIQUIDA,
                processParameters: {
                    instruction: 'Agregue azúcar invertida y agua a la máquina. Encienda agitación y recirculación. Incorpore gradualmente el premix seco.',
                    time_minutes: 20,
                },
                specialInstructions: 'Mantener agitación y recirculación durante 20 minutos.',
            }
        });
        const baseInputs = [
            { productId: ING.azucarInvertida.id, qty: ING.azucarInvertida.qty, name: 'AZUCAR INVERTIDA FRUCTOSA' },
            { productId: ING.agua.id,            qty: ING.agua.qty,            name: 'AGUA' },
        ];
        for (let i = 0; i < baseInputs.length; i++) {
            await tx.assemblyTemplateStageInput.create({
                data: {
                    stageId: s2.id,
                    inputType: 'RAW_MATERIAL',
                    productId: baseInputs[i].productId,
                    quantityPerUnit: baseInputs[i].qty,
                    unit: 'gramo',
                    displayOrder: i + 1,
                }
            });
        }
        console.log('✅ Stage 2 (GE_BASE_LIQUIDA) created with', baseInputs.length, 'inputs');

        // ── Stage 3: GE_COCCION ─────────────────────────────────────
        const s3 = await tx.assemblyTemplateStage.create({
            data: {
                templateId: TMPL101_ID,
                stageOrder: 3,
                stageName: 'Cocción y Enfriamiento — Escarchado',
                processTypeId: PT.GE_COCCION,
                processParameters: {
                    instruction: 'Calentar a 65°C → Enfriar a 45°C y agregar sorbato → Enfriar a 40°C.',
                    checkpoints: [
                        { temp: 65, label: 'Calentamiento', action: null },
                        { temp: 45, label: 'Primer Enfriamiento', action: 'Agregar sorbato de potasio' },
                        { temp: 40, label: 'Enfriamiento Final', action: null },
                    ],
                },
                outputProductId: BASE_ESCARCHADOR_PRODUCT_ID,
                specialInstructions: 'Asegurar completa disolución del sorbato a 45°C.',
            }
        });
        await tx.assemblyTemplateStageInput.create({
            data: {
                stageId: s3.id,
                inputType: 'RAW_MATERIAL',
                productId: ING.sorbato.id,
                quantityPerUnit: ING.sorbato.qty,
                unit: 'gramo',
                displayOrder: 1,
            }
        });
        console.log('✅ Stage 3 (GE_COCCION) created with 1 input (sorbato)');

        // ── Stage 4: G_ENSAMBLE ─────────────────────────────────────
        // All 8 ingredients for the Siigo assembly note
        await tx.assemblyTemplateStage.create({
            data: {
                templateId: TMPL101_ID,
                stageOrder: 4,
                stageName: '(G) Ensamble Final de BASE ESCARCHADOR',
                processTypeId: PT.G_ENSAMBLE,
                outputProductId: BASE_ESCARCHADOR_PRODUCT_ID,
            }
        });
        console.log('✅ Stage 4 (G_ENSAMBLE) created');
    });

    // Verify
    const newStages = await prisma.assemblyTemplateStage.findMany({
        where: { templateId: TMPL101_ID },
        include: { processType: { select: { code: true } }, inputs: { select: { displayOrder: true } } },
        orderBy: { stageOrder: 'asc' }
    });
    console.log('\n📋 TMPL101 new stages:');
    newStages.forEach(s => console.log(`  ${s.stageOrder}. [${s.processType?.code}] ${s.stageName} (${s.inputs.length} inputs)`));
}

async function createBatchEscarchador() {
    console.log('\n━━━ STEP 2: Create BATCH-ESCARCHADOR ━━━\n');

    // Check if already exists
    const existing = await prisma.assemblyTemplate.findFirst({
        where: { templateCode: 'BATCH-ESCARCHADOR' }
    });
    if (existing) {
        console.log('⚠️  BATCH-ESCARCHADOR already exists (id:', existing.id + '). Skipping.');
        return;
    }

    // We need a product for the umbrella batch — use BATCH ESCARCHADOR if it exists
    let batchProduct = await prisma.product.findFirst({
        where: { name: { equals: 'BATCH ESCARCHADOR', mode: 'insensitive' } },
        select: { id: true, name: true }
    });
    if (!batchProduct) {
        console.log('⚠️  Product "BATCH ESCARCHADOR" not found, using BASE ESCARCHADOR as batch product');
        batchProduct = { id: BASE_ESCARCHADOR_PRODUCT_ID, name: 'BASE ESCARCHADOR' };
    }
    console.log('Batch product:', batchProduct.name, batchProduct.id);

    const template = await prisma.$transaction(async (tx) => {
        const newTmpl = await tx.assemblyTemplate.create({
            data: {
                templateCode: 'BATCH-ESCARCHADOR',
                templateName: 'Batch ESCARCHADOR (Sin Saborización)',
                productId: batchProduct.id,
                version: 1,
                totalStages: 4,
                description: 'Batch sombrilla para Sirope Escarchador. Flujo: Base Escarchador (premix+cocción) → Conteo → Empaque 1000ml → Empaque 360ml. Sin etapa de saborización.',
                isActive: true,
            }
        });
        console.log('Template created:', newTmpl.id);

        // Stage 1: sub-template → TMPL101 (BASE ESCARCHADOR)
        await tx.assemblyTemplateStage.create({
            data: {
                templateId: newTmpl.id,
                stageOrder: 1,
                stageName: '📋 BASE ESCARCHADOR',
                processTypeId: PT.G_PESAJE,
                subTemplateId: TMPL101_ID,
            }
        });
        console.log('  Stage 1: sub-template → TMPL101 (BASE ESCARCHADOR)');

        // Stage 2: CONTEO
        await tx.assemblyTemplateStage.create({
            data: {
                templateId: newTmpl.id,
                stageOrder: 2,
                stageName: 'Conteo de Producción por Referencia',
                processTypeId: PT.CONTEO,
            }
        });
        console.log('  Stage 2: CONTEO');

        // Stage 3: sub-template → TMPL-ESC-1000
        await tx.assemblyTemplateStage.create({
            data: {
                templateId: newTmpl.id,
                stageOrder: 3,
                stageName: '📋 LLENADO SIROPE ESCARCHADOR X 1000 ML',
                processTypeId: PT.G_PESAJE,
                subTemplateId: TMPL_ESC_1000_ID,
                outputProductId: SIROPE_1000_PRODUCT_ID,
            }
        });
        console.log('  Stage 3: sub-template → TMPL-ESC-1000');

        // Stage 4: sub-template → TMPL-ESC-360
        await tx.assemblyTemplateStage.create({
            data: {
                templateId: newTmpl.id,
                stageOrder: 4,
                stageName: '📋 LLENADO SIROPE ESCARCHADOR X 360 ML',
                processTypeId: PT.G_PESAJE,
                subTemplateId: TMPL_ESC_360_ID,
                outputProductId: SIROPE_360_PRODUCT_ID,
            }
        });
        console.log('  Stage 4: sub-template → TMPL-ESC-360');

        return newTmpl;
    });

    console.log('\n✅ BATCH-ESCARCHADOR created successfully. ID:', template.id);
}

async function main() {
    console.log('🏭 Migrating Escarchado Flow\n');
    console.log('⚠️  This does NOT touch BATCH-GENIALITY or Liquipops templates.\n');

    await updateTMPL101();
    await createBatchEscarchador();

    console.log('\n🎉 Migration complete!');
    console.log('Next steps:');
    console.log('  1. Wire GE_ steps in frontend (StepDisplay.jsx + useAssemblyNote.js)');
    console.log('  2. Build frontend: cd frontend && npm run build');
    console.log('  3. Restart backend: pm2 restart popping-backend');
    console.log('  4. Test: create a batch with flavor ESCARCHADOR in the scheduler');
}

main()
    .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
