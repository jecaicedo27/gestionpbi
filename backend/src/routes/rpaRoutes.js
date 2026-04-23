const express = require('express');
const router = express.Router();
const rpaController = require('../controllers/rpaController');
const { auth, roles } = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Siigo Assembly Note RPA
router.post('/siigo-assembly', auth, roles(['ADMIN', 'PRODUCCION', 'OPERARIO_PICKING']), rpaController.createSiigoAssemblyNote);

// Siigo Inventory Adjustment RPA
router.post('/siigo-adjustment', auth, roles(['ADMIN', 'PRODUCCION']), rpaController.createSiigoAdjustment);

// RPA History
router.get('/history', auth, roles(['ADMIN', 'PRODUCCION']), rpaController.getHistory);
router.post('/:id/retry', auth, roles(['ADMIN', 'PRODUCCION']), rpaController.retryExecution);

// Queue status
router.get('/queue-status', auth, roles(['ADMIN', 'PRODUCCION']), rpaController.getQueueStatus);

// Orphan notes (COMPLETED EMPAQUE notes with no RPA execution)
router.get('/orphan-notes', auth, roles(['ADMIN', 'PRODUCCION']), rpaController.getOrphanNotes);
router.post('/dispatch-orphan', auth, roles(['ADMIN', 'PRODUCCION']), rpaController.dispatchOrphan);

// Recent adjustment executions by product (for persistent UI state)
router.get('/adjustments/recent', auth, async (req, res) => {
    try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const execs = await prisma.rpaExecution.findMany({
            where: {
                executionType: 'SIIGO_ADJUSTMENT',
                startedAt: { gte: since }
            },
            orderBy: { startedAt: 'desc' },
            select: { id: true, productId: true, productName: true, status: true, siigoNoteCode: true, errorMessage: true }
        });

        // For records without productId, resolve via product name
        let nameToIdCache = null;
        const resolveProductId = async (name) => {
            if (!nameToIdCache) {
                const products = await prisma.product.findMany({ select: { id: true, name: true } });
                nameToIdCache = new Map(products.map(p => [p.name, p.id]));
            }
            return nameToIdCache.get(name) || null;
        };

        const map = {};
        for (const e of execs) {
            let pid = e.productId;
            if (!pid && e.productName) {
                pid = await resolveProductId(e.productName);
                if (pid) {
                    prisma.rpaExecution.update({ where: { id: e.id }, data: { productId: pid } }).catch(() => {});
                }
            }
            if (!pid) continue;
            if (map[pid]) continue;
            if (e.status === 'SUCCESS') map[pid] = { status: 'done', noteCode: e.siigoNoteCode || 'OK', msg: `✅ ${e.siigoNoteCode || 'OK'}` };
            else if (e.status === 'RUNNING') map[pid] = { status: 'running', executionId: e.id, msg: 'RPA ejecutando...' };
            else if (e.status === 'FAILED') map[pid] = { status: 'error', executionId: e.id, msg: e.errorMessage || 'Falló' };
        }
        res.json(map);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get RPA execution by ID
router.get('/:id', auth, async (req, res) => {
    try {
        const exec = await prisma.rpaExecution.findUnique({ where: { id: req.params.id } });
        if (!exec) return res.status(404).json({ error: 'Not found' });
        res.json(exec);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
