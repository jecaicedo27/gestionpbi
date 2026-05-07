/**
 * Auditoría read-only de descuadres entre Siigo (Product.currentStock) y la
 * suma de lotes activos en gestionpbi (material_lots, finished_lot_stock).
 *
 * USO CLI:
 *   node src/scripts/auditInventorySync.js
 *   node src/scripts/auditInventorySync.js --threshold=2000   # solo δ > 2000g
 *
 * USO API:
 *   require('./auditInventorySync').runAudit({ threshold: 1000 })
 *
 * NO modifica nada. Solo reporta.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function runAudit({ threshold = 1000 } = {}) {
    const products = await prisma.product.findMany({
        where: { active: true, unit: 'gramo' },
        select: { id: true, sku: true, name: true, type: true, currentStock: true }
    });
    const productIds = products.map(p => p.id);

    const [matLots, finStocks] = await Promise.all([
        prisma.materialLot.findMany({
            where: { productId: { in: productIds }, status: { in: ['AVAILABLE', 'LOW_STOCK'] } },
            select: { id: true, productId: true, currentQuantity: true, initialQuantity: true, lotNumber: true }
        }),
        prisma.finishedLotStock.findMany({
            where: { productId: { in: productIds }, status: { in: ['AVAILABLE', 'LOW'] } },
            select: { id: true, productId: true, currentQuantity: true, initialQuantity: true, lotNumber: true }
        }),
    ]);

    const matByProduct = new Map();
    const finByProduct = new Map();
    for (const l of matLots) {
        if (!matByProduct.has(l.productId)) matByProduct.set(l.productId, []);
        matByProduct.get(l.productId).push(l);
    }
    for (const l of finStocks) {
        if (!finByProduct.has(l.productId)) finByProduct.set(l.productId, []);
        finByProduct.get(l.productId).push(l);
    }

    const findings = {
        siigoMasQueApp: [],
        appMasQueSiigo: [],
        lotesAnomalos: [],
        baches_sin_lotes: [],
        pesajes_sin_consumos: [],
    };

    for (const p of products) {
        const matList = matByProduct.get(p.id) || [];
        const finList = finByProduct.get(p.id) || [];
        const sumMaterial = matList.reduce((s, l) => s + (l.currentQuantity || 0), 0);
        const sumFinished = finList.reduce((s, l) => s + (l.currentQuantity || 0), 0);
        const sumApp = sumMaterial + sumFinished;
        const siigo = p.currentStock || 0;
        const delta = siigo - sumApp;

        if (Math.abs(delta) > threshold) {
            const entry = { sku: p.sku, name: p.name, siigo, app: sumApp, delta };
            if (delta > 0) findings.siigoMasQueApp.push(entry);
            else findings.appMasQueSiigo.push(entry);
        }

        for (const lot of [...matList, ...finList]) {
            if (lot.currentQuantity > lot.initialQuantity) {
                findings.lotesAnomalos.push({
                    sku: p.sku, lotNumber: lot.lotNumber, lotId: lot.id,
                    initial: lot.initialQuantity, current: lot.currentQuantity,
                });
            }
        }
    }

    const recentDays = 14;
    const cutoff = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);

    const completedBatches = await prisma.productionBatch.findMany({
        where: {
            status: 'COMPLETED',
            completedAt: { gt: cutoff },
            flavor: { notIn: ['FALLA', 'LAVADO', 'CAMBIO DE AGUA', 'PAUSA ACTIVA', 'MANTENIMIENTO', 'REUNION', 'REUNIÓN'] },
        },
        select: {
            id: true, batchNumber: true, flavor: true, completedAt: true,
        }
    });

    for (const b of completedBatches) {
        const [matLots, finLots] = await Promise.all([
            prisma.materialLot.count({ where: { lotNumber: b.batchNumber } }),
            prisma.finishedLotStock.count({ where: { batchId: b.id } }),
        ]);
        if (matLots === 0 && finLots === 0) {
            findings.baches_sin_lotes.push({
                batchNumber: b.batchNumber, flavor: b.flavor, completedAt: b.completedAt,
            });
        }
    }

    const pesajeNotes = await prisma.assemblyNote.findMany({
        where: {
            status: 'COMPLETED',
            completedAt: { gt: cutoff },
            processType: { code: 'PESAJE' },
        },
        select: {
            id: true, noteNumber: true, stageName: true,
            productionBatch: { select: { batchNumber: true } },
        }
    });

    for (const n of pesajeNotes) {
        const consumos = await prisma.lotConsumption.count({ where: { assemblyNoteId: n.id } });
        if (consumos === 0) {
            findings.pesajes_sin_consumos.push({
                noteNumber: n.noteNumber,
                batchNumber: n.productionBatch?.batchNumber,
                stageName: n.stageName,
            });
        }
    }

    const summary = {
        threshold_gr: threshold,
        siigo_mayor_que_app: findings.siigoMasQueApp.length,
        app_mayor_que_siigo: findings.appMasQueSiigo.length,
        lotes_anomalos: findings.lotesAnomalos.length,
        baches_sin_lotes_14d: findings.baches_sin_lotes.length,
        pesajes_sin_consumos_14d: findings.pesajes_sin_consumos.length,
        total_descuadre_kg: Math.round([...findings.siigoMasQueApp, ...findings.appMasQueSiigo]
            .reduce((s, e) => s + Math.abs(e.delta), 0) / 1000),
    };

    return { summary, findings };
}

module.exports = { runAudit };

if (require.main === module) {
    const args = process.argv.slice(2);
    const thresholdArg = args.find(a => a.startsWith('--threshold='));
    const threshold = thresholdArg ? parseInt(thresholdArg.split('=')[1], 10) : 1000;

    runAudit({ threshold })
        .then(({ summary, findings }) => {
            console.log('\n=== AUDITORÍA DE INVENTARIO ===\n');
            console.log('Resumen:', summary, '\n');
            if (findings.siigoMasQueApp.length > 0) {
                console.log('▼ Siigo > App (recepciones missing en app, top 10):');
                findings.siigoMasQueApp.sort((a, b) => b.delta - a.delta).slice(0, 10).forEach(e => {
                    console.log(`  ${e.sku.padEnd(12)} ${e.name.slice(0, 40).padEnd(40)} Siigo=${e.siigo} App=${e.app} Δ=+${e.delta}g`);
                });
            }
            if (findings.appMasQueSiigo.length > 0) {
                console.log('\n▼ App > Siigo (descuentos missing, top 10):');
                findings.appMasQueSiigo.sort((a, b) => a.delta - b.delta).slice(0, 10).forEach(e => {
                    console.log(`  ${e.sku.padEnd(12)} ${e.name.slice(0, 40).padEnd(40)} Siigo=${e.siigo} App=${e.app} Δ=${e.delta}g`);
                });
            }
            if (findings.lotesAnomalos.length > 0) {
                console.log('\n▼ Lotes con currentQuantity > initialQuantity (suma errónea):');
                findings.lotesAnomalos.forEach(l => {
                    console.log(`  ${l.sku} lote ${l.lotNumber} init=${l.initial} cur=${l.current}`);
                });
            }
            if (findings.baches_sin_lotes.length > 0) {
                console.log('\n▼ Baches COMPLETED últimos 14d sin lotes generados:');
                findings.baches_sin_lotes.forEach(b => console.log(`  ${b.batchNumber} (${b.flavor})`));
            }
            if (findings.pesajes_sin_consumos.length > 0) {
                console.log('\n▼ Notas PESAJE COMPLETED últimos 14d sin lot_consumptions:');
                findings.pesajes_sin_consumos.forEach(n => console.log(`  ${n.noteNumber} — ${n.stageName} (bache ${n.batchNumber})`));
            }
            console.log('\n');
        })
        .then(() => prisma.$disconnect())
        .catch(async (e) => {
            console.error(e);
            await prisma.$disconnect();
            process.exit(1);
        });
}
