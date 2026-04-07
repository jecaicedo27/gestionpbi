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
const productiveTraceabilityRoutes = require('./productiveTraceabilityRoutes');
const driverRoutes = require('./driverRoutes');

router.get('/', (req, res) => {
    res.json({ message: 'MRP Popping Boba API' });
});

router.use('/auth', authRoutes);
router.use('/siigo', siigoRoutes);
router.use('/inventory', inventoryRoutes);
const inventoryCountRoutes = require('./inventoryCountRoutes');
router.use('/inventory-count', inventoryCountRoutes);
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

// Geniality Parallel System (Siropes)
const genialityAssemblyTemplateRoutes = require('./genialityTemplateRoutes');
const genialityFormulaRoutes = require('./genialityFormulaRoutes');
const genialityAssemblyNoteRoutes = require('./genialityAssemblyRoutes');
const genialitySchedulerRoutes = require('./genialitySchedulerRoutes');

// Geniality process-types: ONLY G_* codes (exclusive to Geniality production line)
router.get('/geniality/process-types', async (req, res) => {
    try {
        const { PrismaClient: PC } = require('@prisma/client');
        const _pt = new PC();
        const types = await _pt.processType.findMany({
            where: { code: { startsWith: 'G_' }, active: true },
            orderBy: { name: 'asc' }
        });
        await _pt.$disconnect();
        res.json(types);
    } catch (e) { res.status(500).json({ error: 'Failed to fetch geniality process types' }); }
});

// Geniality products: ONLY accountGroups 1402 and 1405 (siropes)
router.get('/geniality/products', async (req, res) => {
    try {
        const { PrismaClient: PC2 } = require('@prisma/client');
        const _pp = new PC2();
        const products = await _pp.product.findMany({
            where: { accountGroup: { in: [1402, 1405] }, active: true },
            select: { id: true, name: true, sku: true, accountGroup: true, unit: true },
            orderBy: { name: 'asc' }
        });
        await _pp.$disconnect();
        res.json(products);
    } catch (e) { res.status(500).json({ error: 'Failed to fetch geniality products' }); }
});

router.use('/geniality/assembly-templates', genialityAssemblyTemplateRoutes);
router.use('/geniality/formulas', genialityFormulaRoutes);
router.use('/geniality/assembly-notes', genialityAssemblyNoteRoutes);
router.use('/geniality/production', genialitySchedulerRoutes);

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

        await _prisma.$transaction(async (tx) => {
            // 1. Get all assembly note IDs for this batch
            const notes = await tx.assemblyNote.findMany({
                where: { productionBatchId: id },
                select: { id: true }
            });
            const noteIds = notes.map(n => n.id);

            if (noteIds.length > 0) {
                // 2. Get all lot consumptions to REVERT before deleting
                const consumptions = await tx.lotConsumption.findMany({
                    where: { assemblyNoteId: { in: noteIds } },
                    select: { materialLotId: true, quantityUsed: true,
                        materialLot: { select: { productId: true } }
                    }
                });

                // 3. Revert each materialLot and product stock
                for (const c of consumptions) {
                    if (c.materialLotId && c.quantityUsed > 0) {
                        await tx.materialLot.update({
                            where: { id: c.materialLotId },
                            data: { currentQuantity: { increment: c.quantityUsed } }
                        });
                        console.log(`[deleteBatch] Reverted ${c.quantityUsed}g → MaterialLot ${c.materialLotId}`);
                    }
                    // Revert product currentStock
                    const productId = c.materialLot?.productId;
                    if (productId && c.quantityUsed > 0) {
                        await tx.product.update({
                            where: { id: productId },
                            data: { currentStock: { increment: c.quantityUsed } }
                        });
                    }
                }

                // 4. Now safe to delete consumptions and notes
                await tx.lotConsumption.deleteMany({ where: { assemblyNoteId: { in: noteIds } } });
                await tx.assemblyNoteItem.deleteMany({ where: { assemblyNoteId: { in: noteIds } } });
                await tx.assemblyNote.deleteMany({ where: { productionBatchId: id } });

                console.log(`[deleteBatch] Reverted ${consumptions.length} consumptions for batch ${id}`);
            }

            await tx.batchOutputTarget.deleteMany({ where: { batchId: id } });
            await tx.productionBatch.delete({ where: { id } });
        });

        res.json({ success: true });
    } catch (err) {
        console.error(`[deleteBatch] ERROR: ${err.message}`);
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
const sanitationRoutes = require('./sanitationRoutes');
router.use('/sanitation', sanitationRoutes);
router.use('/uploads', uploadRoutes);
router.use('/production-kpis', kpiRoutes);
router.use('/procurement', procurementRoutes);
router.use('/productive-traceability', productiveTraceabilityRoutes);
const zoneTransferRoutes = require('./zoneTransferRoutes');
router.use('/zone-transfers', zoneTransferRoutes);
router.use('/cart', cartRoutes);
const finishedLotRoutes = require('./finishedLotRoutes');
router.use('/finished-lots', finishedLotRoutes);
const handoffRoutes = require('./handoffRoutes');
router.use('/handoffs', handoffRoutes);
const physicalCountRoutes = require('./physicalCountRoutes');
router.use('/physical-counts', physicalCountRoutes);
const reconciliationRoutes = require('./reconciliationRoutes');
router.use('/reconciliation', reconciliationRoutes);
const zebraRoutes = require('./zebraRoutes');
router.use('/zebra', zebraRoutes);
router.use('/drivers', driverRoutes);
router.use('/', testRoute);

module.exports = router;
