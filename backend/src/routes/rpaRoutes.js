const express = require('express');
const router = express.Router();
const rpaController = require('../controllers/rpaController');
const { auth, roles } = require('../middleware/auth');

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

// Get RPA execution by ID
router.get('/:id', auth, async (req, res) => {
    try {
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        const exec = await prisma.rpaExecution.findUnique({ where: { id: req.params.id } });
        if (!exec) return res.status(404).json({ error: 'Not found' });
        res.json(exec);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

