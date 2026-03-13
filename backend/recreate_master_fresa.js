require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
    // ── Delete MASTER-FRESA ───────────────────────────────────
    const old = await p.assemblyTemplate.findFirst({ where: { templateCode: 'MASTER-FRESA' } });
    if (old) {
        const stages = await p.assemblyTemplateStage.findMany({ where: { templateId: old.id } });
        for (const s of stages) await p.assemblyTemplateStageInput.deleteMany({ where: { stageId: s.id } });
        await p.assemblyTemplateStage.deleteMany({ where: { templateId: old.id } });
        await p.assemblyTemplate.delete({ where: { id: old.id } });
        console.log('Deleted old MASTER-FRESA');
    }

    // ── Process types ─────────────────────────────────────────
    const ptPesaje = await p.processType.findFirst({ where: { code: 'PESAJE' } });
    const ptForm = await p.processType.findFirst({ where: { code: 'FORMACION' } });
    const ptEnsamble = await p.processType.findFirst({ where: { code: 'ENSAMBLE' } });
    const ptConteo = await p.processType.findFirst({ where: { code: 'CONTEO' } });

    // ── Product lookups ───────────────────────────────────────
    const findP = (name) => p.product.findFirst({ where: { name: { contains: name } }, select: { id: true, name: true } });

    const agua = await findP('AGUA');
    const azucar = await p.product.findFirst({ where: { name: 'AZUCAR' } });
    const azucarInv = await findP('AZUCAR INVERTER');
    const gomas = await findP('PREMEZCLA GOMAS');
    const conserv = await findP('PREMEZCLA CONSERVANTES');
    const calcio = await findP('PREMEZCLA FUENTE DE CALCIO');
    const base = await findP('BASE LIQUIPOPS');
    const colorRojo = await findP('COLOR EN POLVO ROJO PURO');
    const saborDistri = await p.product.findFirst({ where: { name: { contains: 'FRESA DISTRIAROMAS' } } });
    const saborTecnas = await p.product.findFirst({ where: { name: { contains: 'FRESA TECNAS' } } });
    const protonico = await findP('PROTONICO');
    const benzoato = await findP('BENZOATO');
    const sorbato = await findP('SORBATO');
    const azucarFruct = await findP('AZUCAR INVERTIDA FRUCTOSA');
    const fructosa = await findP('FRUCTOSA');
    const colorRojoF = await p.product.findFirst({ where: { name: { contains: 'COLOR EN POLVO ROJO FRESA' } } });
    const acidoCit = await findP('ACIDO CITRICO');
    const sal = await p.product.findFirst({ where: { name: 'SAL' } });
    const alginatoPr = await p.product.findFirst({ where: { name: 'ALGINATO PREPARADO' } });
    const compuesto = await findP('COMPUESTO FRESA');
    const esferas = await findP('ESFERAS FRESA');
    const liq3400 = await findP('LIQUIPOPS SABOR A FRESA X 3400');
    const liq1150 = await findP('LIQUIPOPS SABOR A FRESA X 1150');
    const liq350 = await findP('LIQUIPOPS SABOR A FRESA X 350');
    const proteccion = await findP('PROTECCION FRESA');

    // Tarro assembly components
    const tarro3400 = await findP('TARRO LIQUIPOPS 3400');
    const tapa3400 = await findP('TAPA LIQUIPOPS 3400');
    const liner3400 = await findP('LINER TAPA LIQUIPOPS 3400');
    const etiq3400 = await findP('ETIQUETA LIQUIPOPS SABOR A FRESA X 3400');
    const sello3400 = await findP('SELLO DE SEGURIDAD TARRO LIQUIPOPS 3400');
    const caja3400 = await p.product.findFirst({ where: { name: 'CAJA 3400 29X29X22' } });

    const tarro1150 = await findP('TARRO LIQUIPOPS 1150');
    const tapa1150 = await findP('TAPA LIQUIPOPS 1150');
    const liner1150 = await p.product.findFirst({ where: { name: { contains: 'LINER TAPA LIQUIPOPS 1150' } } });
    const etiq1150 = await findP('ETIQUETA LIQUIPOPS SABOR A FRESA X 1150');
    const sello1150 = await findP('SELLO DE SEGURIDAD TARRO LIQUIPOPS 1150');
    const caja1150 = await p.product.findFirst({ where: { name: 'CAJA 1150 41X29,5X17,5' } });

    const tarro350 = await findP('TARRO LIQUIPOPS 350');
    const tapa350 = await findP('TAPA LIQUIPOPS 350');
    const liner350 = await p.product.findFirst({ where: { name: { contains: 'LINER TAPA LIQUIPOPS 350' } } });
    const etiq350 = await findP('ETIQUETA LIQUIPOPS SABOR A FRESA X 350');
    const sello350 = await findP('SELLO DE SEGURIDAD TARRO LIQUIPOPS 350');
    const caja350 = await p.product.findFirst({ where: { name: 'CAJA 350 38,5X31X20' } });

    // ── Create MASTER-FRESA ───────────────────────────────────
    const master = await p.assemblyTemplate.create({
        data: {
            templateCode: 'MASTER-FRESA',
            templateName: 'Proceso Maestro FRESA — Perlas LIQUIPOPS',
            description: 'Flujo completo: BASE → COMPUESTO → PROTECCION → Formación ESFERAS → CONTEO → Ensamble Tarros',
            productId: esferas.id,
            totalStages: 9,
            isActive: true,
            version: 1,
        }
    });

    async function addStage({ order, name, ptId, outId, classification, inputs, params }) {
        const stage = await p.assemblyTemplateStage.create({
            data: {
                templateId: master.id,
                stageOrder: order,
                stageName: name,
                processTypeId: ptId,
                outputProductId: outId || null,
                outputClassification: classification || 'SEMI_FINISHED',
                processParameters: params || {},
            }
        });
        for (const i of (inputs || [])) {
            if (!i.pid) { console.warn('  Skipping input with null pid for', name); continue; }
            await p.assemblyTemplateStageInput.create({
                data: { stageId: stage.id, productId: i.pid, inputType: i.type || 'RAW_MATERIAL', quantityPerUnit: i.qpu, unit: i.unit }
            });
        }
        console.log(`  Stage ${order}: ${name} | ${(inputs || []).filter(i => i.pid).length} inputs`);
        return stage;
    }

    // Stage 1: Pesaje BASE LIQUIPOPS
    await addStage({
        order: 1, name: 'Pesaje de BASE LIQUIPOPS', ptId: ptPesaje.id, outId: base.id,
        inputs: [
            { pid: agua.id, qpu: 48000, unit: 'gramo' },
            { pid: azucar.id, qpu: 4002, unit: 'gramo' },
            { pid: azucarInv.id, qpu: 66000, unit: 'gramo' },
            { pid: gomas.id, qpu: 1, unit: 'unidad' },
            { pid: conserv.id, qpu: 1, unit: 'unidad' },
            { pid: calcio.id, qpu: 1, unit: 'unidad' },
        ]
    });

    // Stage 2: Pesaje COMPUESTO FRESA
    await addStage({
        order: 2, name: 'Pesaje de COMPUESTO FRESA', ptId: ptPesaje.id, outId: compuesto.id,
        inputs: [
            { pid: base.id, qpu: 120000, unit: 'gramo' },
            { pid: colorRojo?.id, qpu: 12.8, unit: 'gramo' },
            { pid: saborDistri?.id, qpu: 127.8, unit: 'gramo' },
            { pid: saborTecnas?.id, qpu: 235.8, unit: 'gramo' },
            { pid: protonico?.id, qpu: 1775, unit: 'gramo' },
        ]
    });

    // Stage 3: Pesaje PROTECCION FRESA
    await addStage({
        order: 3, name: 'Pesaje de PROTECCION FRESA', ptId: ptPesaje.id, outId: proteccion?.id,
        inputs: [
            { pid: agua.id, qpu: 30933, unit: 'gramo' },
            { pid: benzoato?.id, qpu: 11, unit: 'gramo' },
            { pid: sorbato?.id, qpu: 22, unit: 'gramo' },
            { pid: azucarFruct?.id, qpu: 17331, unit: 'gramo' },
            { pid: fructosa?.id, qpu: 4094, unit: 'gramo' },
            { pid: colorRojoF?.id, qpu: 9, unit: 'gramo' },
            { pid: saborDistri?.id, qpu: 85, unit: 'gramo' },
            { pid: saborTecnas?.id, qpu: 150, unit: 'gramo' },
            { pid: acidoCit?.id, qpu: 1278, unit: 'gramo' },
            { pid: sal?.id, qpu: 88, unit: 'gramo' },
        ]
    });

    // Stage 4: Formación ESFERAS FRESA (alginato + compuesto → esferas)
    await addStage({
        order: 4, name: 'Formación de ESFERAS FRESA', ptId: ptForm.id, outId: esferas.id,
        inputs: [
            { pid: alginatoPr?.id, qpu: 736, unit: 'gramo' },
            { pid: compuesto?.id, qpu: 2250, unit: 'gramo' },
        ]
    });

    // Stage 5: Ensamble Siigo ESFERAS
    await addStage({
        order: 5, name: 'Ensamble Siigo ESFERAS FRESA', ptId: ptEnsamble.id, outId: esferas.id,
        inputs: [{ pid: esferas.id, qpu: 1, unit: 'gramo', type: 'FROM_PREVIOUS_STAGE' }],
        params: { qty_source: 'batch', assemblyType: 'proceso' }
    });

    // Stage 6: CONTEO tarros — NO inputs, just process parameters
    await addStage({
        order: 6, name: 'Conteo de Tarros por Referencia', ptId: ptConteo.id, outId: null,
        classification: 'PRODUCTO_EN_PROCESO', inputs: [],
        params: {
            esfera_factors: {
                [liq3400.id]: 2800,
                [liq1150.id]: 846,
                [liq350.id]: 257
            }
        }
    });

    // Stage 7: Ensamble Siigo LIQUIPOPS 3400g
    await addStage({
        order: 7, name: 'Ensamble Siigo LIQUIPOPS 3400g', ptId: ptEnsamble.id, outId: liq3400.id,
        classification: 'FINISHED_GOOD',
        params: { qty_source: 'conteo', product_id: liq3400.id, assemblyType: 'proceso' },
        inputs: [
            { pid: tarro3400?.id, qpu: 1, unit: 'unidad' },
            { pid: esferas.id, qpu: 2800, unit: 'gramo' },
            { pid: proteccion?.id, qpu: 900, unit: 'gramo' },
            { pid: tapa3400?.id, qpu: 1, unit: 'unidad' },
            { pid: liner3400?.id, qpu: 1, unit: 'unidad' },
            { pid: etiq3400?.id, qpu: 1, unit: 'unidad' },
            { pid: sello3400?.id, qpu: 1, unit: 'unidad' },
            { pid: caja3400?.id, qpu: 0.25, unit: 'unidad' },
        ]
    });

    // Stage 8: Ensamble Siigo LIQUIPOPS 1150g
    await addStage({
        order: 8, name: 'Ensamble Siigo LIQUIPOPS 1150g', ptId: ptEnsamble.id, outId: liq1150.id,
        classification: 'FINISHED_GOOD',
        params: { qty_source: 'conteo', product_id: liq1150.id, assemblyType: 'proceso' },
        inputs: [
            { pid: tarro1150?.id, qpu: 1, unit: 'unidad' },
            { pid: esferas.id, qpu: 846, unit: 'gramo' },
            { pid: proteccion?.id, qpu: 304, unit: 'gramo' },
            { pid: tapa1150?.id, qpu: 1, unit: 'unidad' },
            { pid: liner1150?.id, qpu: 1, unit: 'unidad' },
            { pid: etiq1150?.id, qpu: 1, unit: 'unidad' },
            { pid: sello1150?.id, qpu: 1, unit: 'unidad' },
            { pid: caja1150?.id, qpu: 0.833, unit: 'unidad' },
        ]
    });

    // Stage 9: Ensamble Siigo LIQUIPOPS 350g
    await addStage({
        order: 9, name: 'Ensamble Siigo LIQUIPOPS 350g', ptId: ptEnsamble.id, outId: liq350.id,
        classification: 'FINISHED_GOOD',
        params: { qty_source: 'conteo', product_id: liq350.id, assemblyType: 'proceso' },
        inputs: [
            { pid: tarro350?.id, qpu: 1, unit: 'unidad' },
            { pid: esferas.id, qpu: 257, unit: 'gramo' },
            { pid: proteccion?.id, qpu: 100, unit: 'gramo' },
            { pid: tapa350?.id, qpu: 1, unit: 'unidad' },
            { pid: liner350?.id, qpu: 1, unit: 'unidad' },
            { pid: etiq350?.id, qpu: 1, unit: 'unidad' },
            { pid: sello350?.id, qpu: 1, unit: 'unidad' },
            { pid: caja350?.id, qpu: 0.025, unit: 'unidad' },
        ]
    });

    console.log('\n✅ MASTER-FRESA recreada correctamente con 9 etapas');
    await p.$disconnect();
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
