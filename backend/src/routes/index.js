const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

const authRoutes = require('./authRoutes');
const siigoRoutes = require('./siigoRoutes');
const inventoryRoutes = require('./inventoryRoutes');
const productionRoutes = require('./productionRoutes');
const productionSchedulerRoutes = require('./productionSchedulerRoutes'); // New
const auditRoutes = require('./auditRoutes');
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
const forensicRecoveryRoutes = require('./forensicRecoveryRoutes');
const inventoryAuditRoutes = require('./inventoryAuditRoutes');

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
router.use('/audit', auditRoutes);
router.use('/inventory-audit', inventoryAuditRoutes);
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
router.get('/products', auth, inventoryController.getProductsSimple);

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
router.get('/geniality/process-types', auth, async (req, res) => {
    try {
        const types = await _prisma.processType.findMany({
            where: { code: { startsWith: 'G_' }, active: true },
            orderBy: { name: 'asc' }
        });
        res.json(types);
    } catch (e) { res.status(500).json({ error: 'Failed to fetch geniality process types' }); }
});

// Geniality products: ONLY accountGroups 1402 and 1405 (siropes)
router.get('/geniality/products', auth, async (req, res) => {
    try {
        const products = await _prisma.product.findMany({
            where: { accountGroup: { in: [1402, 1405] }, active: true },
            select: { id: true, name: true, sku: true, accountGroup: true, unit: true },
            orderBy: { name: 'asc' }
        });
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
router.get('/production-batches', auth, async (req, res) => {
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
router.delete('/production-batches/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;

        const batch = await _prisma.productionBatch.findUnique({ where: { id }, select: { batchNumber: true } });
        if (!batch) return res.status(404).json({ error: 'Batch no encontrado' });

        await _prisma.$transaction(async (tx) => {
            const notes = await tx.assemblyNote.findMany({
                where: { productionBatchId: id },
                select: { id: true }
            });
            const noteIds = notes.map(n => n.id);

            if (noteIds.length > 0) {
                // 1. Revert input consumptions (return materials to source lots)
                const consumptions = await tx.lotConsumption.findMany({
                    where: { assemblyNoteId: { in: noteIds } },
                    select: {
                        materialLotId: true, quantityUsed: true,
                        materialLot: { select: { productId: true } }
                    }
                });

                for (const c of consumptions) {
                    if (c.materialLotId && c.quantityUsed > 0) {
                        const updated = await tx.materialLot.update({
                            where: { id: c.materialLotId },
                            data: { currentQuantity: { increment: c.quantityUsed } },
                            select: { id: true, currentQuantity: true, status: true, initialQuantity: true }
                        });
                        const newStatus = updated.currentQuantity <= 0 ? 'DEPLETED'
                            : updated.currentQuantity < (updated.initialQuantity * 0.1) ? 'LOW_STOCK'
                                : 'AVAILABLE';
                        if (newStatus !== updated.status) {
                            await tx.materialLot.update({
                                where: { id: updated.id },
                                data: { status: newStatus }
                            });
                        }
                        console.log(`[deleteBatch] Reverted ${c.quantityUsed}g → MaterialLot ${c.materialLotId} (cur ahora ${updated.currentQuantity}, status ${newStatus})`);
                    }
                    const productId = c.materialLot?.productId;
                    if (productId && c.quantityUsed > 0) {
                        await tx.product.update({
                            where: { id: productId },
                            data: {
                                currentStock: { increment: c.quantityUsed },
                                productionZoneStock: { increment: c.quantityUsed }
                            }
                        });
                    }
                }

                // 2. Delete/zero output MaterialLots created by this batch (intermediate products like fructosa/base)
                const outputLots = await tx.materialLot.findMany({
                    where: { lotNumber: batch.batchNumber },
                    select: { id: true, productId: true, currentQuantity: true, siigoProductName: true }
                });
                for (const ol of outputLots) {
                    if (ol.productId && ol.currentQuantity > 0) {
                        await tx.product.update({
                            where: { id: ol.productId },
                            data: {
                                currentStock: { decrement: ol.currentQuantity },
                                productionZoneStock: { decrement: ol.currentQuantity }
                            }
                        });
                    }
                    // Try to delete; if FK constraint (another batch consumed from this lot), zero it out
                    const hasConsumptions = await tx.lotConsumption.count({ where: { materialLotId: ol.id } });
                    if (hasConsumptions > 0) {
                        await tx.materialLot.update({
                            where: { id: ol.id },
                            data: { currentQuantity: 0, status: 'DEPLETED' }
                        });
                        console.log(`[deleteBatch] Zeroed output MaterialLot ${ol.siigoProductName} (${ol.currentQuantity}g) — has ${hasConsumptions} external consumptions`);
                    } else {
                        await tx.materialLot.delete({ where: { id: ol.id } });
                        console.log(`[deleteBatch] Deleted output MaterialLot ${ol.siigoProductName} (${ol.currentQuantity}g)`);
                    }
                }

                // 3. Revertir/borrar FinishedLotStocks creados por este bache.
                //    Si el lote ya tuvo despachos/ventas registradas (transfers fuera
                //    del bache), NO se borra — solo se pone en 0/DEPLETED para
                //    preservar trazabilidad. Borrarlo perdería el histórico de
                //    salidas y dejaría transfers huérfanos.
                const outputFinished = await tx.finishedLotStock.findMany({
                    where: { batchId: id },
                    select: { id: true, productId: true, currentQuantity: true, lotNumber: true }
                });
                let blockedFinished = 0;
                for (const of_ of outputFinished) {
                    if (of_.productId && of_.currentQuantity > 0) {
                        await tx.product.update({
                            where: { id: of_.productId },
                            data: {
                                currentStock: { decrement: of_.currentQuantity },
                                productionZoneStock: { decrement: of_.currentQuantity }
                            }
                        });
                    }
                    // ¿Hay transfers de salida (despacho/venta) para este lote?
                    const externalTransfers = await tx.finishedLotTransfer.count({
                        where: {
                            finishedLotStockId: of_.id,
                            reason: { not: { contains: 'Ingreso desde producción' } }
                        }
                    });
                    if (externalTransfers > 0) {
                        // Tiene salidas: zero-out (no borrar) para preservar histórico
                        await tx.finishedLotStock.update({
                            where: { id: of_.id },
                            data: { currentQuantity: 0, status: 'DEPLETED' }
                        });
                        blockedFinished++;
                        console.log(`[deleteBatch] Zeroed FinishedLotStock ${of_.id} (lote ${of_.lotNumber}, ${of_.currentQuantity} uds) — ${externalTransfers} salidas/ventas previas, no se borra`);
                    } else {
                        await tx.finishedLotStock.delete({ where: { id: of_.id } });
                        console.log(`[deleteBatch] Deleted FinishedLotStock ${of_.id} (lote ${of_.lotNumber}, ${of_.currentQuantity} uds)`);
                    }
                }
                if (blockedFinished > 0) {
                    console.warn(`[deleteBatch] ⚠️ ${blockedFinished} FinishedLotStocks no se borraron (ya tuvieron salidas) — quedaron en DEPLETED para preservar trazabilidad`);
                }

                // 4. Delete RPA executions linked to this batch's notes
                await tx.rpaExecution.deleteMany({ where: { assemblyNoteId: { in: noteIds } } });

                // 5. Delete consumptions, items, and notes
                await tx.lotConsumption.deleteMany({ where: { assemblyNoteId: { in: noteIds } } });
                await tx.assemblyNoteItem.deleteMany({ where: { assemblyNoteId: { in: noteIds } } });
                await tx.assemblyNote.deleteMany({ where: { productionBatchId: id } });

                console.log(`[deleteBatch] Reverted ${consumptions.length} consumptions, deleted ${outputLots.length} output lots, ${outputFinished.length} finished lots for batch ${batch.batchNumber}`);
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
router.get('/batch-history', auth, batchHistoryController.list);
router.get('/batch-history/:batchId', auth, batchHistoryController.detail);

const mrpForecastController = require('../controllers/mrpForecastController');
router.get('/mrp-forecast', auth, mrpForecastController.forecast);

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
router.use('/forensic-recovery', forensicRecoveryRoutes);
const zoneTransferRoutes = require('./zoneTransferRoutes');
router.use('/zone-transfers', zoneTransferRoutes);
const printRoutes = require('./printRoutes');
router.use('/print', printRoutes);
router.use('/cart', cartRoutes);
const finishedLotRoutes = require('./finishedLotRoutes');
router.use('/finished-lots', finishedLotRoutes);
const materialLotRoutes = require('./materialLotRoutes');
router.use('/material-lots', materialLotRoutes);
const handoffRoutes = require('./handoffRoutes');
router.use('/handoffs', handoffRoutes);
const physicalCountRoutes = require('./physicalCountRoutes');
router.use('/physical-counts', physicalCountRoutes);
const reconciliationRoutes = require('./reconciliationRoutes');
router.use('/reconciliation', reconciliationRoutes);
const zebraRoutes = require('./zebraRoutes');
router.use('/zebra', zebraRoutes);
router.use('/drivers', driverRoutes);
const shiftRoutes = require('./shiftRoutes');
router.use('/shifts', shiftRoutes);
const attendanceRoutes = require('./attendanceRoutes');
router.use('/attendance', attendanceRoutes);
const shiftHandoverRoutes = require('./shiftHandoverRoutes');
router.use('/shift-handover', shiftHandoverRoutes);
const shiftDisciplineRoutes = require('./shiftDisciplineRoutes');
router.use('/shift-discipline', shiftDisciplineRoutes);
const academiaRoutes = require('./academiaRoutes');
router.use('/academia', academiaRoutes);
const cleaningRoutes = require('./cleaningRoutes');
router.use('/cleaning', cleaningRoutes);
router.use('/', testRoute);

module.exports = router;
