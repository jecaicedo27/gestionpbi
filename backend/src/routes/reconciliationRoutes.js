const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { auth } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════
// 1. GET /stock — Siigo vs App stock comparison
// ═══════════════════════════════════════════════════════
router.get('/stock', auth, async (req, res) => {
    try {
        const { classification, onlyDiff, search } = req.query;

        // Build filter
        const where = { active: true };
        if (classification) where.classification = classification;
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
            ];
        }

        // Get all active products
        const products = await prisma.product.findMany({
            where,
            select: {
                id: true, sku: true, name: true, classification: true,
                currentStock: true, unit: true, warehouses: true,
                group: { select: { name: true } },
            },
            orderBy: { name: 'asc' },
        });

        // Aggregate MaterialLot stock per product
        const mlAgg = await prisma.materialLot.groupBy({
            by: ['productId', 'zone'],
            _sum: { currentQuantity: true },
            where: { currentQuantity: { gt: 0 } },
        });
        const mlMap = {};
        for (const row of mlAgg) {
            if (!mlMap[row.productId]) mlMap[row.productId] = {};
            mlMap[row.productId][row.zone] = row._sum.currentQuantity || 0;
        }

        // Aggregate FinishedLotStock per product
        const flsAgg = await prisma.finishedLotStock.groupBy({
            by: ['productId', 'zone'],
            _sum: { currentQuantity: true },
            where: { currentQuantity: { gt: 0 } },
        });
        const flsMap = {};
        for (const row of flsAgg) {
            if (!flsMap[row.productId]) flsMap[row.productId] = {};
            flsMap[row.productId][row.zone] = row._sum.currentQuantity || 0;
        }

        // Build result rows
        const rows = products.map(p => {
            const ml = mlMap[p.id] || {};
            const fls = flsMap[p.id] || {};

            const appWarehouse = (ml.WAREHOUSE || 0);
            const appProduction = (ml.PRODUCTION || 0);
            const appTerminado = (fls.PRODUCTO_TERMINADO || 0);
            const appCuarentena = (fls.CUARENTENA || 0);
            const appNoConforme = (fls.NO_CONFORME || 0);
            const appMaquila = (fls.MAQUILA || 0);
            const appProduccion = (fls.PRODUCCION || 0);

            const totalApp = appWarehouse + appProduction + appTerminado + appCuarentena + appNoConforme + appMaquila + appProduccion;
            const siigoStock = p.currentStock || 0;
            const diff = siigoStock - totalApp;

            return {
                id: p.id,
                sku: p.sku,
                name: p.name,
                classification: p.classification,
                group: p.group?.name || null,
                unit: p.unit,
                siigoStock,
                appZones: {
                    warehouse: appWarehouse,
                    production: appProduction,
                    terminado: appTerminado,
                    cuarentena: appCuarentena,
                    noConforme: appNoConforme,
                    maquila: appMaquila,
                    produccion: appProduccion,
                },
                totalApp,
                diff,
                status: diff === 0 ? 'OK' : Math.abs(diff) <= 2 ? 'WARN' : 'ERROR',
            };
        });

        // Filter only differences if requested
        const filtered = onlyDiff === 'true' ? rows.filter(r => r.diff !== 0) : rows;

        // Summary stats
        const summary = {
            total: filtered.length,
            ok: filtered.filter(r => r.status === 'OK').length,
            warn: filtered.filter(r => r.status === 'WARN').length,
            error: filtered.filter(r => r.status === 'ERROR').length,
        };

        res.json({ summary, rows: filtered });
    } catch (err) {
        console.error('reconciliation/stock error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════
// 2. GET /production — Production batch → Siigo verification
// ═══════════════════════════════════════════════════════
router.get('/production', auth, async (req, res) => {
    try {
        const { status, limit = 50 } = req.query;

        const where = {};
        if (status) where.status = status;

        const batches = await prisma.productionBatch.findMany({
            where,
            include: {
                product: { select: { id: true, sku: true, name: true } },
                assemblyNotes: {
                    select: {
                        id: true,
                        status: true,
                        stageOrder: true,
                        stageName: true,
                        actualParameters: true,
                        rpaExecutions: {
                            select: { id: true, status: true, siigoNoteCode: true, startedAt: true, errorMessage: true },
                            orderBy: { startedAt: 'desc' },
                            take: 1,
                        },
                    },
                    orderBy: { stageOrder: 'asc' },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit),
        });

        const rows = batches.map(b => {
            const stages = b.assemblyNotes.length;
            const lastNote = b.assemblyNotes[b.assemblyNotes.length - 1];
            
            // Check RPA registrations across all notes
            const allRpa = b.assemblyNotes.flatMap(n => n.rpaExecutions);
            const successRpa = allRpa.filter(r => r.status === 'SUCCESS');
            const failedRpa = allRpa.filter(r => r.status === 'FAILED');
            const pendingRpa = allRpa.filter(r => r.status === 'RUNNING');

            // Extract produced quantity from empaque note
            let producedQty = null;
            for (const note of b.assemblyNotes) {
                const params = note.actualParameters;
                if (params?.empaque?.approved != null) {
                    producedQty = params.empaque.approved;
                } else if (params?.produced != null) {
                    producedQty = params.produced;
                }
            }

            let siigoStatus = 'PENDING';
            if (successRpa.length > 0) siigoStatus = 'SYNCED';
            else if (failedRpa.length > 0) siigoStatus = 'ERROR';
            else if (pendingRpa.length > 0) siigoStatus = 'RUNNING';

            return {
                id: b.id,
                batchNumber: b.batchNumber,
                flavor: b.flavor,
                status: b.status,
                createdAt: b.createdAt,
                product: b.product,
                stages,
                producedQty,
                siigoStatus,
                siigoCode: successRpa[0]?.siigoNoteCode || null,
                rpaError: failedRpa[0]?.errorMessage || null,
                rpaCount: { success: successRpa.length, failed: failedRpa.length, pending: pendingRpa.length },
            };
        });

        const summary = {
            total: rows.length,
            synced: rows.filter(r => r.siigoStatus === 'SYNCED').length,
            pending: rows.filter(r => r.siigoStatus === 'PENDING').length,
            error: rows.filter(r => r.siigoStatus === 'ERROR').length,
        };

        res.json({ summary, rows });
    } catch (err) {
        console.error('reconciliation/production error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════
// 3. GET /sales — Sales (Siigo) vs Lot Consumptions (App)
// ═══════════════════════════════════════════════════════
router.get('/sales', auth, async (req, res) => {
    try {
        const { months = 3, classification } = req.query;

        const since = new Date();
        since.setMonth(since.getMonth() - parseInt(months));

        // Only sellable groups: GENIALITY and LIQUIPOPS
        const productWhere = {
            active: true,
            group: { name: { in: ['GENIALITY', 'LIQUIPOPS'] } },
        };
        if (classification) productWhere.classification = classification;

        // Get products
        const products = await prisma.product.findMany({
            where: productWhere,
            select: { id: true, sku: true, name: true, classification: true, unit: true, group: { select: { name: true } } },
        });
        const productIds = products.map(p => p.id);
        const productMap = {};
        products.forEach(p => { productMap[p.id] = p; });

        // Sales from Movements (VTA)
        const salesAgg = await prisma.movement.groupBy({
            by: ['productId'],
            _sum: { quantity: true },
            _count: true,
            where: {
                type: 'VTA',
                date: { gte: since },
                productId: { in: productIds },
            },
        });
        const salesMap = {};
        for (const row of salesAgg) {
            salesMap[row.productId] = { qty: row._sum.quantity || 0, count: row._count };
        }

        // Lot consumptions
        const consumptionAgg = await prisma.lotConsumption.groupBy({
            by: ['materialLotId'],
            _sum: { quantityUsed: true },
            where: {
                usedAt: { gte: since },
                materialLot: { productId: { in: productIds } },
            },
        });
        // Need to map materialLotId → productId
        const lotIds = consumptionAgg.map(c => c.materialLotId);
        const lots = lotIds.length > 0
            ? await prisma.materialLot.findMany({
                  where: { id: { in: lotIds } },
                  select: { id: true, productId: true },
              })
            : [];
        const lotProductMap = {};
        lots.forEach(l => { lotProductMap[l.id] = l.productId; });

        const consumedMap = {};
        for (const row of consumptionAgg) {
            const pid = lotProductMap[row.materialLotId];
            if (pid) consumedMap[pid] = (consumedMap[pid] || 0) + (row._sum.quantityUsed || 0);
        }

        // Build rows — only include products with sales or consumptions
        const rows = products
            .filter(p => salesMap[p.id] || consumedMap[p.id])
            .map(p => {
                const sold = salesMap[p.id]?.qty || 0;
                const invoiceCount = salesMap[p.id]?.count || 0;
                const consumed = consumedMap[p.id] || 0;
                const diff = sold - consumed;

                return {
                    id: p.id,
                    sku: p.sku,
                    name: p.name,
                    classification: p.classification,
                    group: p.group?.name || 'Sin grupo',
                    unit: p.unit,
                    sold,
                    invoiceCount,
                    consumed,
                    diff,
                    status: diff === 0 ? 'OK' : Math.abs(diff) <= 2 ? 'WARN' : 'ERROR',
                };
            })
            .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

        const summary = {
            total: rows.length,
            ok: rows.filter(r => r.status === 'OK').length,
            warn: rows.filter(r => r.status === 'WARN').length,
            error: rows.filter(r => r.status === 'ERROR').length,
            periodMonths: parseInt(months),
        };

        res.json({ summary, rows });
    } catch (err) {
        console.error('reconciliation/sales error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
