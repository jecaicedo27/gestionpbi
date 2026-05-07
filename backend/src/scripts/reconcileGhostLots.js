/**
 * Reconciliación de lotes fantasma en zona PRODUCCION.
 *
 * USO:
 *   node src/scripts/reconcileGhostLots.js [--dry-run] [--min-age-hours=24]
 *
 * QUÉ HACE:
 *   Para cada producto finished, identifica lotes en zone='PRODUCCION' con
 *   currentQuantity > 0 cuyo bache esté COMPLETED y vacía los huérfanos —
 *   pero SOLO si el lote tiene más de N horas (default 24h). Esto previene
 *   que se vacíen lotes recién producidos antes de que Siigo sincronice.
 *
 * CONTEXTO:
 *   El 2026-05-05 se corrió una versión sin filtro de tiempo y borró
 *   1.226 unidades, de las cuales ~600 eran lotes legítimos recién creados.
 *   Restaurados manualmente el 2026-05-06.
 *
 * ALCANCE:
 *   Solo productos terminados de LIQUIPOPS y GENIALITY (no material de empaque,
 *   no perlas, no productos en proceso). Esto se decidió tras la restauración
 *   2026-05-06 — empaque/MP tiene su propio flujo y no se reconcilia aquí.
 *
 * REGLA:
 *   Un lote es "huérfano" SOLO si:
 *     - producto en grupo LIQUIPOPS o GENIALITY
 *     - bache COMPLETED (o batchId nulo)
 *     - createdAt < NOW() - minAgeHours
 *     - SUM(lotes activos del producto) > Product.currentStock (delta Siigo)
 */

const ALLOWED_GROUPS = ['LIQUIPOPS', 'GENIALITY'];

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const MIN_AGE_HOURS = parseInt(
    (args.find(a => a.startsWith('--min-age-hours=')) || '--min-age-hours=24').split('=')[1],
    10
);

const REASON = `Reconciliación ${new Date().toISOString().slice(0, 10)}: lote huérfano de bache COMPLETED — Siigo es fuente de verdad`;

async function main() {
    console.log(`\n[reconcile] DRY_RUN=${DRY_RUN} MIN_AGE_HOURS=${MIN_AGE_HOURS}`);
    const cutoff = new Date(Date.now() - MIN_AGE_HOURS * 60 * 60 * 1000);
    console.log(`[reconcile] Solo se tocan lotes creados antes de: ${cutoff.toISOString()}\n`);

    // 1. Lotes activos en zona PRODUCCION cuyos baches estén COMPLETED y tengan más de N horas
    //    Filtrados a productos del grupo LIQUIPOPS o GENIALITY (terminado).
    const candidatos = await prisma.finishedLotStock.findMany({
        where: {
            zone: 'PRODUCCION',
            currentQuantity: { gt: 0 },
            createdAt: { lt: cutoff },
            product: { group: { name: { in: ALLOWED_GROUPS } } },
            OR: [
                { batchId: null },
                { batch: { status: 'COMPLETED' } },
            ],
        },
        include: {
            product: {
                select: {
                    id: true, sku: true, name: true, currentStock: true,
                    group: { select: { name: true } },
                },
            },
            batch: { select: { id: true, status: true } },
        },
    });

    console.log(`[reconcile] ${candidatos.length} lotes candidatos (>${MIN_AGE_HOURS}h, bache COMPLETED)`);

    // 2. Agrupar por producto y validar contra Siigo
    const porProducto = new Map();
    for (const lot of candidatos) {
        const key = lot.product.id;
        if (!porProducto.has(key)) porProducto.set(key, { product: lot.product, lots: [] });
        porProducto.get(key).lots.push(lot);
    }

    let totalLotes = 0;
    let totalUnds = 0;
    const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });

    for (const { product, lots } of porProducto.values()) {
        const todosLotes = await prisma.finishedLotStock.findMany({
            where: { productId: product.id, status: 'AVAILABLE' },
        });
        const sumActivos = todosLotes.reduce((a, l) => a + l.currentQuantity, 0);
        const exceso = sumActivos - (product.currentStock || 0);
        if (exceso <= 0) continue;

        console.log(`\n  ${product.sku} — Siigo:${product.currentStock} lotes:${sumActivos} exceso:${exceso}`);

        // FEFO inverso: borrar primero los más viejos hasta cubrir el exceso
        lots.sort((a, b) => a.createdAt - b.createdAt);
        let pendiente = exceso;
        for (const lot of lots) {
            if (pendiente <= 0) break;
            const aBorrar = Math.min(pendiente, lot.currentQuantity);
            console.log(`    [${lot.lotNumber}] ${lot.currentQuantity} → ${lot.currentQuantity - aBorrar} (-${aBorrar})`);

            if (!DRY_RUN) {
                await prisma.$transaction([
                    prisma.finishedLotStock.update({
                        where: { id: lot.id },
                        data: {
                            currentQuantity: lot.currentQuantity - aBorrar,
                            status: lot.currentQuantity - aBorrar === 0 ? 'DEPLETED' : 'AVAILABLE',
                        },
                    }),
                    prisma.finishedLotTransfer.create({
                        data: {
                            finishedLotStockId: lot.id,
                            productId: product.id,
                            lotNumber: lot.lotNumber,
                            fromZone: 'PRODUCCION',
                            toZone: 'PRODUCCION',
                            quantity: aBorrar,
                            reason: REASON,
                            transferredById: adminUser?.id || null,
                        },
                    }),
                ]);
            }
            totalLotes++;
            totalUnds += aBorrar;
            pendiente -= aBorrar;
        }
    }

    console.log(`\n[reconcile] ${DRY_RUN ? '[DRY-RUN]' : '[APLICADO]'} ${totalLotes} lotes ajustados / ${totalUnds} unidades.\n`);
}

main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
