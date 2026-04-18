const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function check() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  VERIFICACIÓN COMPLETA DEL SISTEMA');
    console.log('  ' + new Date().toISOString());
    console.log('═══════════════════════════════════════════════════\n');

    // 1. Check active production batches
    console.log('── 1. BATCHES ACTIVOS ──');
    const active = await p.productionBatch.findMany({
        where: { status: { notIn: ['COMPLETED', 'FAILED'] } },
        select: { batchNumber: true, flavor: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' }
    });
    for (const b of active) {
        const t = new Date(b.createdAt.getTime() - 5*3600000).toISOString().substring(0,16);
        console.log('  ' + b.batchNumber + ' | ' + b.status + ' | ' + t);
    }
    console.log('  Total: ' + active.length);

    // 2. Check notes in EXECUTING status (stuck?)
    console.log('\n── 2. NOTAS EN EXECUTING (en proceso) ──');
    const executing = await p.assemblyNote.findMany({
        where: { status: 'EXECUTING' },
        include: { productionBatch: { select: { batchNumber: true } } },
        orderBy: { startedAt: 'desc' }
    });
    if (executing.length === 0) {
        console.log('  (ninguna)');
    } else {
        for (const n of executing) {
            const hours = n.startedAt ? ((Date.now() - n.startedAt.getTime()) / 3600000).toFixed(1) : '?';
            console.log('  ⚡ ' + n.stageName + ' | ' + (n.productionBatch?.batchNumber || '?') + ' | ' + hours + 'h');
        }
    }

    // 3. Check templates integrity
    console.log('\n── 3. INTEGRIDAD DE PLANTILLAS CLAVE ──');
    const templates = [
        { code: 'TMPL-BASELIQ-001', name: 'BASE LIQUIPOPS', expectedStages: 4 },
        { code: 'TMPL007', name: 'ALGINATO PREPARADO', expectedStages: 6 },
        { code: 'TMPL008', name: 'COMPUESTO', expectedStages: 2 },
        { code: 'BATCH-LIQUIPOPS', name: 'BATCH-LIQUIPOPS GENÉRICO', expectedStages: 11 },
    ];
    for (const t of templates) {
        const tpl = await p.assemblyTemplate.findFirst({
            where: { templateCode: t.code, isActive: true },
            include: { stages: { include: { inputs: true, processType: { select: { code: true } } }, orderBy: { stageOrder: 'asc' } } }
        });
        if (!tpl) { console.log('  ❌ ' + t.code + ' — NOT FOUND'); continue; }
        const ok = tpl.stages.length === t.expectedStages;
        console.log('  ' + (ok ? '✅' : '⚠️') + ' ' + t.code + ' (' + t.name + ') — ' + tpl.stages.length + ' stages' + (ok ? '' : ' (esperado: ' + t.expectedStages + ')'));
        
        // Check for duplicate inputs in consuming stages
        for (const s of tpl.stages) {
            if (!['PESAJE', 'ENSAMBLE'].includes(s.processType?.code)) continue;
            const productIds = s.inputs.map(i => i.productId);
            const dupes = productIds.filter((id, i) => productIds.indexOf(id) !== i && productIds.lastIndexOf(id) === i);
            // Special: AZUCAR INVERTER GLUCOSA should allow duplicate (intentional 2x33kg)
            const realDupes = dupes.filter(id => id !== 'db809b54-2c8a-46dc-b12a-53cd50c5ee95');
            if (realDupes.length > 0) {
                console.log('    ⚠️ Stage [' + s.stageOrder + '] ' + s.stageName + ' has unexpected duplicates');
            }
        }
        // Check that COCCION/ENFRIAMIENTO stages have 0 inputs (don't consume)
        for (const s of tpl.stages) {
            if (s.processType?.code === 'COCCION' && s.inputs.length > 0) {
                console.log('    ⚠️ Stage [' + s.stageOrder + '] ' + s.stageName + ' (COCCION) has ' + s.inputs.length + ' inputs — should be 0!');
            }
        }
    }

    // 4. Check zone stock discrepancies for key products
    console.log('\n── 4. STOCK DE ZONA — DISCREPANCIAS ──');
    const keyProducts = await p.product.findMany({
        where: { productionZoneStock: { gt: 0 } },
        select: { id: true, name: true, productionZoneStock: true }
    });
    let discrepancies = 0;
    for (const prod of keyProducts) {
        const agg = await p.materialLot.aggregate({
            where: { productId: prod.id, zone: 'PRODUCTION', currentQuantity: { gt: 0 }, status: { in: ['AVAILABLE', 'LOW_STOCK'] } },
            _sum: { currentQuantity: true }
        });
        const realZone = agg._sum.currentQuantity || 0;
        const drift = Math.abs(prod.productionZoneStock - realZone);
        if (drift > 1000) { // >1kg drift
            discrepancies++;
            console.log('  ⚠️ ' + prod.name + ': cache=' + (prod.productionZoneStock/1000).toFixed(1) + 'kg | real=' + (realZone/1000).toFixed(1) + 'kg | drift=' + (drift/1000).toFixed(1) + 'kg');
        }
    }
    if (discrepancies === 0) console.log('  ✅ Sin discrepancias significativas (>1kg)');

    // 5. Check MARACUYA-260415-0903 batch specific
    console.log('\n── 5. BATCH MARACUYA-260415-0903 — DETALLE ──');
    const batch = await p.productionBatch.findFirst({ where: { batchNumber: { contains: 'MARACUYA-260415-0903' } } });
    if (batch) {
        const notes = await p.assemblyNote.findMany({
            where: { productionBatchId: batch.id },
            include: { items: { include: { component: { select: { name: true } } } }, processType: { select: { code: true } } },
            orderBy: { stageOrder: 'asc' }
        });
        for (const n of notes) {
            const code = n.processType?.code || '?';
            const canConsume = ['PESAJE', 'EMPAQUE'].includes(code);
            console.log('  [' + n.stageOrder + '] ' + n.stageName + ' (' + code + ') — ' + n.status + (canConsume ? ' 💰CONSUME' : ''));
            for (const it of n.items) {
                const nm = it.component?.name || '?';
                const qty = it.plannedQuantity || 0;
                const agg = await p.materialLot.aggregate({
                    where: { productId: it.componentId, zone: 'PRODUCTION', currentQuantity: { gt: 0 }, status: { in: ['AVAILABLE', 'LOW_STOCK'] } },
                    _sum: { currentQuantity: true }
                });
                const rz = agg._sum.currentQuantity || 0;
                const ok = rz >= qty * 0.95 || nm.toUpperCase() === 'AGUA';
                console.log('    ' + (ok ? '✅' : '❌') + ' ' + nm + ': ' + (qty/1000).toFixed(1) + 'kg | zona: ' + (rz/1000).toFixed(1) + 'kg');
            }
        }
    }

    // 6. PM2 process status
    console.log('\n── 6. PM2 STATUS ──');
    const { execSync } = require('child_process');
    const pm2 = execSync('pm2 jlist 2>/dev/null').toString();
    const procs = JSON.parse(pm2);
    for (const proc of procs) {
        const mem = (proc.monit?.memory / 1048576).toFixed(0);
        const restarts = proc.pm2_env?.restart_time || 0;
        const status = proc.pm2_env?.status;
        console.log('  ' + (status === 'online' ? '✅' : '❌') + ' ' + proc.name + ' | ' + status + ' | RAM: ' + mem + 'MB | restarts: ' + restarts);
    }

    console.log('\n═══════════════════════════════════════════════════');
    console.log('  VERIFICACIÓN COMPLETA');
    console.log('═══════════════════════════════════════════════════');


    await p.$disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });
