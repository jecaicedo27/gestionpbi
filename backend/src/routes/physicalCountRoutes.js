const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { auth } = require('../middleware/auth');

// Finished product account groups (same as finishedLotRoutes)
const FINISHED_PRODUCT_GROUPS = ['PRODUCTO TERMINADO', 'TERMINADO', 'PRODUCTO FINAL'];

// ── POST / — Start a new physical count ──────────────────────────────────────
router.post('/', auth, async (req, res) => {
    try {
        const { checklist } = req.body;
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Usuario no autenticado' });

        // Verify no open count exists
        const existing = await prisma.physicalCount.findFirst({
            where: { status: 'IN_PROGRESS' },
        });
        if (existing) {
            return res.status(400).json({
                error: 'Ya existe un conteo en progreso. Ciérrelo primero.',
                existingId: existing.id,
            });
        }

        // Get all products with stock in PRODUCTO_TERMINADO
        const stocks = await prisma.finishedLotStock.groupBy({
            by: ['productId'],
            where: { zone: 'PRODUCTO_TERMINADO', currentQuantity: { gt: 0 } },
            _sum: { currentQuantity: true },
        });

        if (stocks.length === 0) {
            return res.status(400).json({ error: 'No hay productos en Producto Terminado para contar' });
        }

        // Get product details
        const productIds = stocks.map(s => s.productId);
        const products = await prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, sku: true, packSize: true, unit: true },
        });
        const productMap = {};
        products.forEach(p => { productMap[p.id] = p; });

        // Create count + items in transaction
        const count = await prisma.$transaction(async (tx) => {
            const pc = await tx.physicalCount.create({
                data: {
                    countedById: userId,
                    zone: 'PRODUCTO_TERMINADO',
                    checklist: checklist || {},
                    items: {
                        create: stocks.map(s => ({
                            productId: s.productId,
                            systemQuantity: s._sum.currentQuantity || 0,
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

// ── GET /active — Get active count (if any) ──────────────────────────────────
router.get('/active', auth, async (req, res) => {
    try {
        const count = await prisma.physicalCount.findFirst({
            where: { status: 'IN_PROGRESS' },
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
        const { items } = req.body; // [{ itemId, countedBoxes, countedLoose }]

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'items array requerido' });
        }

        // Verify count exists and is IN_PROGRESS
        const count = await prisma.physicalCount.findUnique({ where: { id } });
        if (!count) return res.status(404).json({ error: 'Conteo no encontrado' });
        if (count.status !== 'IN_PROGRESS') {
            return res.status(400).json({ error: 'El conteo ya está cerrado' });
        }

        // Get all items with product info for packSize
        const countItems = await prisma.physicalCountItem.findMany({
            where: { physicalCountId: id },
            include: { product: { select: { packSize: true } } },
        });
        const itemMap = {};
        countItems.forEach(ci => { itemMap[ci.id] = ci; });

        // Batch update
        const updates = [];
        for (const item of items) {
            const existing = itemMap[item.itemId];
            if (!existing) continue;
            const boxes = parseInt(item.countedBoxes) || 0;
            const loose = parseInt(item.countedLoose) || 0;
            const packSize = existing.product?.packSize || 1;
            const total = (boxes * packSize) + loose;

            updates.push(
                prisma.physicalCountItem.update({
                    where: { id: item.itemId },
                    data: {
                        countedBoxes: boxes,
                        countedLoose: loose,
                        countedTotal: total,
                        difference: total - existing.systemQuantity,
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

        // Recalculate differences with FRESH system quantities
        const productIds = count.items.map(i => i.productId);
        const freshStocks = await prisma.finishedLotStock.groupBy({
            by: ['productId'],
            where: { zone: 'PRODUCTO_TERMINADO', productId: { in: productIds }, currentQuantity: { gt: 0 } },
            _sum: { currentQuantity: true },
        });
        const freshMap = {};
        freshStocks.forEach(s => { freshMap[s.productId] = s._sum.currentQuantity || 0; });

        // Update all items with final differences
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

        // Close the count
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

        // Return the closed count with fresh data
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
        const counts = await prisma.physicalCount.findMany({
            where: { status: 'CLOSED' },
            include: {
                countedBy: { select: { id: true, name: true } },
                _count: { select: { items: true } },
            },
            orderBy: { startedAt: 'desc' },
            take: 30,
        });

        // Add summary stats per count
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
