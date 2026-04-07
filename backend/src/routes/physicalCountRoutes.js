const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { auth } = require('../middleware/auth');

// Brand → product name filter mapping
const BRAND_FILTERS = {
    LIQUIPOPS: { name: { contains: 'LIQUIPOPS', mode: 'insensitive' } },
    GENIALITY: {
        AND: [
            { name: { contains: 'GENIALITY', mode: 'insensitive' } },
            { NOT: { name: { contains: 'PROCEGENIALITY', mode: 'insensitive' } } },
        ]
    },
};

// Build Prisma where clause for brand+zone matching (backward compatible)
const countWhere = (brand, zone) => {
    const brandClause = brand === 'GENIALITY'
        ? { checklist: { path: ['brand'], equals: 'GENIALITY' } }
        : { NOT: { checklist: { path: ['brand'], equals: 'GENIALITY' } } };
    const zoneClause = zone && zone !== 'ALL'
        ? { checklist: { path: ['zone'], equals: zone } }
        : {};
    return { ...brandClause, ...zoneClause };
};

// Available counting zones
const COUNT_ZONES = ['PRODUCTO_TERMINADO', 'BODEGA', 'CUARENTENA', 'MAQUILA'];

// ── UTIL: Get Adjusted System Quantities (Subtracts Picked Items) ────────────
async function getAdjustedSystemQuantities(zone, productIds) {
    // 1. Get raw contable stock from FinishedLotStock
    const liveStocks = await prisma.finishedLotStock.groupBy({
        by: ['productId'],
        where: { zone, productId: { in: productIds }, currentQuantity: { gt: 0 } },
        _sum: { currentQuantity: true },
    });
    
    // 2. If zone is PRODUCTO_TERMINADO, find items already separated for orders but not yet invoiced
    let pickedMap = {};
    if (zone === 'PRODUCTO_TERMINADO') {
        const pendingItems = await prisma.orderItem.findMany({
            where: {
                productId: { in: productIds },
                order: { status: { in: ['IN_PICKING', 'READY'] } }
            },
            include: { pickingItems: true }
        });
        
        for (const item of pendingItems) {
            const qty = item.pickingItems.reduce((acc, pi) => acc + (pi.scannedQty || 0), 0);
            pickedMap[item.productId] = (pickedMap[item.productId] || 0) + qty;
        }
    }

    // 3. Subtract picked from raw
    const resultMap = {};
    for (const pid of productIds) {
        const stockRow = liveStocks.find(s => s.productId === pid);
        const raw = stockRow ? (stockRow._sum.currentQuantity || 0) : 0;
        const picked = pickedMap[pid] || 0;
        resultMap[pid] = Math.max(0, raw - picked); // Never go below 0 artificially
    }
    return resultMap;
}


// ── POST / — Start a new physical count ──────────────────────────────────────
router.post('/', auth, async (req, res) => {
    try {
        const { checklist, brand = 'LIQUIPOPS', zone = 'PRODUCTO_TERMINADO' } = req.body;
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Usuario no autenticado' });
        if (!COUNT_ZONES.includes(zone)) return res.status(400).json({ error: `Zona inválida: ${zone}` });

        const brandFilter = BRAND_FILTERS[brand] || BRAND_FILTERS.LIQUIPOPS;

        // Verify no open count for this brand+zone combo
        const existing = await prisma.physicalCount.findFirst({
            where: { status: 'IN_PROGRESS', ...countWhere(brand, zone) },
        });
        if (existing) {
            return res.status(400).json({
                error: `Ya existe un conteo ${brand} en progreso. Ciérrelo primero.`,
                existingId: existing.id,
            });
        }

        // Get products matching the brand filter
        const brandProducts = await prisma.product.findMany({
            where: brandFilter,
            select: { id: true },
        });
        const brandProductIds = brandProducts.map(p => p.id);

        if (brandProductIds.length === 0) {
            return res.status(400).json({ error: `No se encontraron productos de ${brand}` });
        }

        // Get adjusted system quantities (subtracting picked but not dispatched items)
        const systemQtys = await getAdjustedSystemQuantities(zone, brandProductIds);
        
        // Filter out products that have 0 theoretical stock for this zone
        const productsToCount = brandProductIds.filter(pid => systemQtys[pid] > 0);

        if (productsToCount.length === 0) {
            return res.status(400).json({ error: `No hay productos de ${brand} en zona ${zone} para contar` });
        }

        // Get product details
        const products = await prisma.product.findMany({
            where: { id: { in: productsToCount } },
            select: { id: true, name: true, sku: true, packSize: true, unit: true },
        });
        const productMap = {};
        products.forEach(p => { productMap[p.id] = p; });

        // Create count + items in transaction
        const count = await prisma.$transaction(async (tx) => {
            const pc = await tx.physicalCount.create({
                data: {
                    countedById: userId,
                    zone: zone,
                    checklist: { ...(checklist || {}), brand, zone },
                    items: {
                        create: productsToCount.map(pid => ({
                            productId: pid,
                            systemQuantity: systemQtys[pid] || 0,
                        })),
                    },
                },
                include: {
                    items: {
                        include: {
                            product: { select: { id: true, name: true, sku: true, packSize: true, unit: true } },
                        },
                        orderBy: { product: { name: 'asc' } },
                    },
                },
            });
            return pc;
        });

        res.json({ success: true, count });
    } catch (err) {
        console.error('physical-counts POST error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /active — Get active count with LIVE system quantities ────────────────
router.get('/active', auth, async (req, res) => {
    try {
        const brand = req.query.brand || 'LIQUIPOPS';
        const zone = req.query.zone || 'PRODUCTO_TERMINADO';

        const count = await prisma.physicalCount.findFirst({
            where: { status: 'IN_PROGRESS', ...countWhere(brand, zone) },
            include: {
                items: {
                    include: {
                        product: { select: { id: true, name: true, sku: true, packSize: true, unit: true } },
                    },
                    orderBy: { product: { name: 'asc' } },
                },
                countedBy: { select: { id: true, name: true } },
            },
        });

        if (count && count.items.length > 0) {
            // ── Inject LIVE systemQuantity (adjusted for picked items) ────────
            const countZone = count.checklist?.zone || zone;
            const productIds = count.items.map(i => i.productId);
            
            const liveMap = await getAdjustedSystemQuantities(countZone, productIds);

            // Override systemQuantity and recalculate difference in real time
            count.items = count.items.map(item => ({
                ...item,
                systemQuantity: liveMap[item.productId] ?? 0,
                difference: item.countedTotal - (liveMap[item.productId] ?? 0),
            }));
        }

        res.json({ count });
    } catch (err) {
        console.error('physical-counts/active error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── PATCH /:id/items — Batch update counted quantities ───────────────────────
router.patch('/:id/items', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { items } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'items array requerido' });
        }

        const count = await prisma.physicalCount.findUnique({ where: { id } });
        if (!count) return res.status(404).json({ error: 'Conteo no encontrado' });
        if (count.status !== 'IN_PROGRESS') {
            return res.status(400).json({ error: 'El conteo ya está cerrado' });
        }

        const countItems = await prisma.physicalCountItem.findMany({
            where: { physicalCountId: id },
            include: { product: { select: { packSize: true } } },
        });
        const itemMap = {};
        countItems.forEach(ci => { itemMap[ci.id] = ci; });

        // ── Fetch LIVE system quantities (adjusted for picked items) ──────────
        const countZone = count.checklist?.zone || 'PRODUCTO_TERMINADO';
        const productIds = countItems.map(ci => ci.productId);
        
        const liveMap = await getAdjustedSystemQuantities(countZone, productIds);

        const updates = [];
        for (const item of items) {
            const existing = itemMap[item.itemId];
            if (!existing) continue;
            const boxes = parseInt(item.countedBoxes) || 0;
            const loose = parseInt(item.countedLoose) || 0;
            const packSize = existing.product?.packSize || 1;
            const total = (boxes * packSize) + loose;
            const liveSystemQty = liveMap[existing.productId] ?? 0;

            updates.push(
                prisma.physicalCountItem.update({
                    where: { id: item.itemId },
                    data: {
                        countedBoxes: boxes,
                        countedLoose: loose,
                        countedTotal: total,
                        difference: total - liveSystemQty,   // always vs live stock
                    },
                })
            );
        }

        await prisma.$transaction(updates);
        res.json({ success: true, updated: updates.length });
    } catch (err) {
        console.error('physical-counts PATCH items error:', err);
        res.status(500).json({ error: err.message });
    }
});


// ── POST /:id/close — Close count and calculate differences ──────────────────
router.post('/:id/close', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { observations } = req.body;

        const count = await prisma.physicalCount.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        product: { select: { id: true, name: true, sku: true, packSize: true, unit: true } },
                    },
                },
            },
        });

        if (!count) return res.status(404).json({ error: 'Conteo no encontrado' });
        if (count.status !== 'IN_PROGRESS') {
            return res.status(400).json({ error: 'El conteo ya está cerrado' });
        }

        // Recalculate differences with FRESH system quantities (adjusted) from the COUNT's zone
        const countZone = count.checklist?.zone || 'PRODUCTO_TERMINADO';
        const productIds = count.items.map(i => i.productId);
        
        const freshMap = await getAdjustedSystemQuantities(countZone, productIds);

        const updates = count.items.map(item => {
            const freshSys = freshMap[item.productId] || 0;
            return prisma.physicalCountItem.update({
                where: { id: item.id },
                data: {
                    systemQuantity: freshSys,
                    difference: item.countedTotal - freshSys,
                },
            });
        });

        updates.push(
            prisma.physicalCount.update({
                where: { id },
                data: {
                    status: 'CLOSED',
                    closedAt: new Date(),
                    observations: observations || null,
                },
            })
        );

        await prisma.$transaction(updates);

        const closed = await prisma.physicalCount.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        product: { select: { id: true, name: true, sku: true, packSize: true, unit: true } },
                    },
                    orderBy: { product: { name: 'asc' } },
                },
                countedBy: { select: { id: true, name: true } },
            },
        });

        res.json({ success: true, count: closed });
    } catch (err) {
        console.error('physical-counts close error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /history — List past counts ──────────────────────────────────────────
router.get('/history', auth, async (req, res) => {
    try {
        const brand = req.query.brand || 'LIQUIPOPS';
        const zone = req.query.zone || null;

        const counts = await prisma.physicalCount.findMany({
            where: { status: 'CLOSED', ...countWhere(brand, zone) },
            include: {
                countedBy: { select: { id: true, name: true } },
                _count: { select: { items: true } },
            },
            orderBy: { startedAt: 'desc' },
            take: 30,
        });

        const results = [];
        for (const c of counts) {
            const items = await prisma.physicalCountItem.findMany({
                where: { physicalCountId: c.id },
                select: { difference: true },
            });
            const ok = items.filter(i => i.difference === 0).length;
            const over = items.filter(i => i.difference > 0).length;
            const under = items.filter(i => i.difference < 0).length;
            results.push({ ...c, summary: { ok, over, under, total: items.length } });
        }

        res.json({ counts: results });
    } catch (err) {
        console.error('physical-counts history error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /:id — Get a specific count detail ───────────────────────────────────
router.get('/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const count = await prisma.physicalCount.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        product: { select: { id: true, name: true, sku: true, packSize: true, unit: true } },
                    },
                    orderBy: { product: { name: 'asc' } },
                },
                countedBy: { select: { id: true, name: true } },
            },
        });

        if (!count) return res.status(404).json({ error: 'Conteo no encontrado' });
        res.json({ count });
    } catch (err) {
        console.error('physical-counts GET detail error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
