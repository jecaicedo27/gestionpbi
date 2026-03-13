const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const siigoRoutes = require('./siigoRoutes');
const inventoryRoutes = require('./inventoryRoutes');
const productionRoutes = require('./productionRoutes');
const productionSchedulerRoutes = require('./productionSchedulerRoutes'); // New
const rpaRoutes = require('./rpaRoutes');
const labelRoutes = require('./labelRoutes');
const billingRoutes = require('./billingRoutes');
const webhookRoutes = require('./webhookRoutes');
const adminRoutes = require('./adminRoutes');
const orderRoutes = require('./orderRoutes');
const orderWorkflowRoutes = require('./orderWorkflow');
const distributorRoutes = require('./distributorRoutes');
const analyticsRoutes = require('./analyticsRoutes');
// const replenishmentRoutes = require('./replenishmentRoutes');
// const consumptionRoutes = require('./consumptionRoutes');

// Assembly System Routes
const processTypeRoutes = require('./processTypeRoutes');
const assemblyTemplateRoutes = require('./assemblyTemplateRoutes');
const formulaRoutes = require('./formulaRoutes');
const assemblyNoteRoutes = require('./assemblyNoteRoutes');
const mrpRoutes = require('./mrpRoutes');
const movementRoutes = require('./movementRoutes');

const testRoute = require('./testRoute');
const reportRoutes = require('./reportRoutes');
const configRoutes = require('./configRoutes');
const pqrRoutes = require('./pqrRoutes');
const internalPqrRoutes = require('./internalPqrRoutes');
const microRoutes = require('./microRoutes');
const uploadRoutes = require('./uploadRoutes');
const kpiRoutes = require('./kpiRoutes');
const procurementRoutes = require('./procurementRoutes');
const pushRoutes = require('./pushSubscriptionRoutes');
const cartRoutes = require('./cartRoutes');

router.get('/', (req, res) => {
    res.json({ message: 'MRP Popping Boba API' });
});

router.use('/auth', authRoutes);
router.use('/siigo', siigoRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/orders', orderRoutes);
router.use('/orders', orderWorkflowRoutes);
router.use('/distributor', distributorRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/production', productionRoutes);
router.use('/production/liquipops', productionSchedulerRoutes); // New
router.use('/rpa', rpaRoutes);
router.use('/labels', labelRoutes);
router.use('/billing', billingRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/push', pushRoutes);
// router.use('/replenishment', replenishmentRoutes);
// router.use('/consumption', consumptionRoutes);

// Assembly System
const inventoryController = require('../controllers/inventoryController');
router.get('/products', inventoryController.getProductsSimple);

router.use('/process-types', processTypeRoutes);
router.use('/assembly-templates', assemblyTemplateRoutes);
router.use('/formulas', formulaRoutes);
router.use('/assembly-notes', assemblyNoteRoutes);
router.use('/mrp', mrpRoutes);
router.use('/movements', movementRoutes);

// Lightweight production batch list (for premix conflict detection)
const { PrismaClient } = require('@prisma/client');
const _prisma = new PrismaClient();
router.get('/production-batches', async (req, res) => {
    try {
        const { productId, active } = req.query;
        const where = {};
        if (productId) where.productId = productId;
        if (active === 'true') where.status = { notIn: ['COMPLETED', 'FAILED'] };
        const batches = await _prisma.productionBatch.findMany({
            where,
            include: {
                assemblyNotes: { select: { id: true, status: true, stageOrder: true }, orderBy: { stageOrder: 'asc' } }
            },
            orderBy: { createdAt: 'desc' },
            take: 20
        });
        res.json(batches);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.delete('/production-batches/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Delete assembly note items first, then notes, then batch
        const notes = await _prisma.assemblyNote.findMany({ where: { productionBatchId: id }, select: { id: true } });
        const noteIds = notes.map(n => n.id);
        if (noteIds.length > 0) {
            await _prisma.assemblyNoteItem.deleteMany({ where: { assemblyNoteId: { in: noteIds } } });
            await _prisma.assemblyNote.deleteMany({ where: { productionBatchId: id } });
        }
        await _prisma.productionBatch.delete({ where: { id } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Batch History (admin audit view)
const batchHistoryController = require('../controllers/batchHistoryController');
router.get('/batch-history', batchHistoryController.list);
router.get('/batch-history/:batchId', batchHistoryController.detail);

router.use('/reports', reportRoutes);
router.use('/admin', adminRoutes);
router.use('/config', configRoutes);
router.use('/pqr', pqrRoutes);
router.use('/internal-pqr', internalPqrRoutes);
router.use('/micro', microRoutes);
router.use('/uploads', uploadRoutes);
router.use('/production-kpis', kpiRoutes);
router.use('/procurement', procurementRoutes);
const zoneTransferRoutes = require('./zoneTransferRoutes');
router.use('/zone-transfers', zoneTransferRoutes);
router.use('/cart', cartRoutes);
router.use('/', testRoute);

module.exports = router;
