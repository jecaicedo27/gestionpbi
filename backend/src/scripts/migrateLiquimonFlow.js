/**
 * migrateLiquimonFlow.js
 *
 * 1. Creates TMPL-LIQ-BASE (Base Cítrica Limón sub-template):
 *      Stage 1: GE_BASE_LIQUIDA (7 ingredients mixed in water)
 *      Stage 2: G_ENSAMBLE (Siigo assembly for BASE CITRICA LIMON)
 *
 * 2. Creates BATCH-LIQUIMON umbrella template:
 *      Stage 1: sub-template → TMPL-LIQ-BASE (Base Cítrica)
 *      Stage 2: CONTEO
 *      Stage 3: sub-template → TMPL109 (Llenado 1000ml)
 *      Stage 4: sub-template → TMPL110 (Llenado 500ml)
 *
 * Safe: Does NOT touch BATCH-GENIALITY, BATCH-ESCARCHADOR, or Liquipops templates.
 *
 * Usage: node backend/src/scripts/migrateLiquimonFlow.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Product IDs ──────────────────────────────────────────────────────────
const BATCH_LIQUIMON_PRODUCT_ID = 'fb11e202-a7b1-4461-9ede-2fb5917dfe08';
const BASE_CITRICA_PRODUCT_ID   = '596d843a-bfb6-481f-98fe-6092067dabbe';
const LIQUIMON_500_PRODUCT_ID   = 'b60496ee-9fda-46d0-b5e9-0590e83b498c';
const LIQUIMON_1000_PRODUCT_ID  = '050edbc4-3c24-405c-a2f7-4a591e3bb5cd';

// ── Existing llenado sub-templates ───────────────────────────────────────
const TMPL109_ID = '13aef3b9-3872-4a6a-b8d8-f0720361d32c'; // Llenado 1000ml
const TMPL110_ID = '5ac1900a-4164-4d30-984b-00b887a16cea'; // Llenado 500ml

// ── ProcessType IDs ──────────────────────────────────────────────────────
const PT = {
    GE_BASE_LIQUIDA: '9ac48c20-08a0-4098-b235-f4f34ec6a6a0',
    G_ENSAMBLE:      '0ce7f023-ef61-4562-bc46-35fe8beb6549',
    CONTEO:          '646507ff-f327-44f9-bdaa-1d8655bcda04',
    G_PESAJE:        'cc2060eb-3138-464c-9e72-4e2a17f989d1',
};

// ── Base Cítrica ingredients (FORM145, total ≈111,697.85g) ───────────────
// quantityPerUnit = proportion of total (sums to ~1.0)
const TOTAL_BASE = 100000 + 9500 + 2015 + 150 + 0.85 + 2 + 30; // 111697.85g
const ING = {
    agua:            { id: 'd4d4e32a-5d35-40a0-bbbe-e78e93ba5dca', qty: 100000,  name: 'AGUA' },
    acidoCitrico:    { id: 'bb69257c-9041-490b-9c25-2955106927cd', qty: 9500,    name: 'ACIDO CITRICO' },
    acidoTartarico:  { id: '581fae46-931b-47d3-baaa-3d06586238bf', qty: 2015,    name: 'ACIDO TARTARICO' },
    gomaXhantan:     { id: '345d5b6c-3976-4676-8b5b-0b15df7ed891', qty: 150,     name: 'GOMA XHANTAN' },
    colorAmarillo:   { id: 'fa51f2ae-b308-49d7-a052-6eb5f32e6a9b', qty: 0.85,    name: 'COLOR AMARILLO LIMON' },
    dioxidoTitanio:  { id: '111298e5-c23b-4db0-9d98-e85ff70f30f9', qty: 2,       name: 'DIOXIDO DE TITANIO' },
    antiespumante:   { id: '8b86134e-2a03-45d3-9e2a-c44da58c9dc0', qty: 30,      name: 'ANTIESPUMANTE TECNAS' },
};

async function createTmplLiqBase() {
    console.log('━━━ STEP 1: Create TMPL-LIQ-BASE (Base Cítrica Limón) ━━━\n');

    const existing = await prisma.assemblyTemplate.findFirst({
        where: { templateCode: 'TMPL-LIQ-BASE' }
    });
    if (existing) {
        console.log('⚠️  TMPL-LIQ-BASE already exists (id:', existing.id + '). Skipping.');
        return existing.id;
    }

    const tmpl = await prisma.$transaction(async (tx) => {
        const newTmpl = await tx.assemblyTemplate.create({
            data: {
                templateCode: 'TMPL-LIQ-BASE',
                templateName: 'Base Cítrica Limón — LIQUIMON',
                productId: BASE_CITRICA_PRODUCT_ID,
                version: 1,
                totalStages: 2,
                description: 'Sub-template para producción de Base Cítrica Limón. Mezcla de agua + ácidos + goma + colorante + antiespumante.',
                isActive: true,
            }
        });
        console.log('Template created:', newTmpl.id);

        // Stage 1: GE_BASE_LIQUIDA — mix all ingredients
        const s1 = await tx.assemblyTemplateStage.create({
            data: {
                templateId: newTmpl.id,
                stageOrder: 1,
                stageName: 'Mezcla Base Cítrica — LIQUIMON',
                processTypeId: PT.GE_BASE_LIQUIDA,
                processParameters: {
                    instruction: 'Disolver ácido cítrico y tartárico en agua caliente. Agregar goma xantana, colorante, dióxido de titanio y antiespumante.',
                },
                outputProductId: BASE_CITRICA_PRODUCT_ID,
                specialInstructions: 'Orden: agua → ácido cítrico → ácido tartárico → goma xantana → colorante amarillo limón → dióxido de titanio → antiespumante.',
            }
        });

        const ingredients = Object.values(ING);
        for (let i = 0; i < ingredients.length; i++) {
            await tx.assemblyTemplateStageInput.create({
                data: {
                    stageId: s1.id,
                    inputType: 'RAW_MATERIAL',
                    productId: ingredients[i].id,
                    quantityPerUnit: ingredients[i].qty / TOTAL_BASE,
                    unit: 'gramo',
                    displayOrder: i + 1,
                }
            });
        }
        console.log('✅ Stage 1 (GE_BASE_LIQUIDA) created with', ingredients.length, 'inputs');

        // Stage 2: G_ENSAMBLE — Siigo assembly
        await tx.assemblyTemplateStage.create({
            data: {
                templateId: newTmpl.id,
                stageOrder: 2,
                stageName: '(G) Ensamble Final de BASE CITRICA LIMON',
                processTypeId: PT.G_ENSAMBLE,
                outputProductId: BASE_CITRICA_PRODUCT_ID,
            }
        });
        console.log('✅ Stage 2 (G_ENSAMBLE) created');

        return newTmpl;
    });

    // Verify
    const stages = await prisma.assemblyTemplateStage.findMany({
        where: { templateId: tmpl.id },
        include: { processType: { select: { code: true } }, inputs: { select: { displayOrder: true } } },
        orderBy: { stageOrder: 'asc' }
    });
    console.log('\n📋 TMPL-LIQ-BASE stages:');
    stages.forEach(s => console.log(`  ${s.stageOrder}. [${s.processType?.code}] ${s.stageName} (${s.inputs.length} inputs)`));

    return tmpl.id;
}

async function createBatchLiquimon(tmplLiqBaseId) {
    console.log('\n━━━ STEP 2: Create BATCH-LIQUIMON ━━━\n');

    const existing = await prisma.assemblyTemplate.findFirst({
        where: { templateCode: 'BATCH-LIQUIMON' }
    });
    if (existing) {
        console.log('⚠️  BATCH-LIQUIMON already exists (id:', existing.id + '). Skipping.');
        return;
    }

    const template = await prisma.$transaction(async (tx) => {
        const newTmpl = await tx.assemblyTemplate.create({
            data: {
                templateCode: 'BATCH-LIQUIMON',
                templateName: 'Batch LIQUIMON (Base Cítrica Estandarizada)',
                productId: BATCH_LIQUIMON_PRODUCT_ID,
                version: 1,
                totalStages: 4,
                description: 'Batch sombrilla para LIQUIMON. Flujo: Base Cítrica Limón → Conteo → Llenado 1000ml → Llenado 500ml. Con ensamble Siigo y recepción de carritos parciales.',
                isActive: true,
            }
        });
        console.log('Template created:', newTmpl.id);

        // Stage 1: sub-template → TMPL-LIQ-BASE
        await tx.assemblyTemplateStage.create({
            data: {
                templateId: newTmpl.id,
                stageOrder: 1,
                stageName: '📋 BASE CITRICA LIQUIMON',
                processTypeId: PT.G_PESAJE,
                subTemplateId: tmplLiqBaseId,
            }
        });
        console.log('  Stage 1: sub-template → TMPL-LIQ-BASE');

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

        // Stage 3: sub-template → TMPL109 (Llenado 1000ml)
        await tx.assemblyTemplateStage.create({
            data: {
                templateId: newTmpl.id,
                stageOrder: 3,
                stageName: '📋 LLENADO LIQUIMON X 1000 ML',
                processTypeId: PT.G_PESAJE,
                subTemplateId: TMPL109_ID,
                outputProductId: LIQUIMON_1000_PRODUCT_ID,
            }
        });
        console.log('  Stage 3: sub-template → TMPL109 (Llenado 1000ml)');

        // Stage 4: sub-template → TMPL110 (Llenado 500ml)
        await tx.assemblyTemplateStage.create({
            data: {
                templateId: newTmpl.id,
                stageOrder: 4,
                stageName: '📋 LLENADO LIQUIMON X 500 ML',
                processTypeId: PT.G_PESAJE,
                subTemplateId: TMPL110_ID,
                outputProductId: LIQUIMON_500_PRODUCT_ID,
            }
        });
        console.log('  Stage 4: sub-template → TMPL110 (Llenado 500ml)');

        return newTmpl;
    });

    console.log('\n✅ BATCH-LIQUIMON created successfully. ID:', template.id);
}

async function main() {
    console.log('🏭 Creating LIQUIMON Batch Templates\n');
    console.log('⚠️  This does NOT touch BATCH-GENIALITY, BATCH-ESCARCHADOR, or Liquipops templates.\n');

    const tmplLiqBaseId = await createTmplLiqBase();
    await createBatchLiquimon(tmplLiqBaseId);

    console.log('\n🎉 Migration complete!');
    console.log('Next steps:');
    console.log('  1. Update genialityAssemblyNoteController.js for BATCH-LIQUIMON');
    console.log('  2. Update ProductionScheduler.jsx to detect LIQUIMON flavor');
    console.log('  3. Build frontend: cd frontend && npx vite build');
    console.log('  4. Restart backend: pm2 restart popping-backend');
}

main()
    .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
