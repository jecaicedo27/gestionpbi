const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Batch History Controller — admin audit view
 * GET /api/batch-history          → paginated list with KPIs
 * GET /api/batch-history/:batchId → full detail with timeline
 */
const batchHistoryController = {

    // ── LIST: paginated batches with summary KPIs ────────────────────────────
    list: async (req, res) => {
        try {
            const {
                page = 1, limit = 20,
                search, status, flavor,
                dateFrom, dateTo,
                sortBy = 'createdAt', sortDir = 'desc'
            } = req.query;

            const skip = (parseInt(page) - 1) * parseInt(limit);
            const take = parseInt(limit);

            // Build WHERE clause
            const where = {};
            if (status) where.status = status;
            if (flavor) where.flavor = { contains: flavor, mode: 'insensitive' };
            if (search) {
                where.OR = [
                    { batchNumber: { contains: search, mode: 'insensitive' } },
                    { flavor: { contains: search, mode: 'insensitive' } }
                ];
            }
            if (dateFrom || dateTo) {
                where.createdAt = {};
                if (dateFrom) where.createdAt.gte = new Date(dateFrom);
                if (dateTo) {
                    const end = new Date(dateTo);
                    end.setHours(23, 59, 59, 999);
                    where.createdAt.lte = end;
                }
            }

            const [batches, total] = await Promise.all([
                prisma.productionBatch.findMany({
                    where,
                    skip,
                    take,
                    orderBy: { [sortBy]: sortDir },
                    include: {
                        product: { select: { id: true, name: true } },
                        outputTargets: {
                            include: { product: { select: { name: true } } }
                        },
                        assemblyNotes: {
                            select: {
                                id: true,
                                stageName: true,
                                stageOrder: true,
                                status: true,
                                startedAt: true,
                                completedAt: true,
                                actualQuantity: true,
                                targetQuantity: true,
                                processType: { select: { code: true, name: true } },
                                completedBy: { select: { name: true } },
                                processParameters: true
                            },
                            orderBy: { stageOrder: 'asc' }
                        }
                    }
                }),
                prisma.productionBatch.count({ where })
            ]);

            // Enrich with computed KPIs
            const enriched = batches.map(batch => {
                const notes = batch.assemblyNotes || [];
                const completed = notes.filter(n => n.status === 'COMPLETED');
                const firstStarted = completed.reduce((min, n) =>
                    n.startedAt && (!min || n.startedAt < min) ? n.startedAt : min
                    , null);
                const lastCompleted = completed.reduce((max, n) =>
                    n.completedAt && (!max || n.completedAt > max) ? n.completedAt : max
                    , null);

                // Duration
                const durationMs = firstStarted && lastCompleted
                    ? new Date(lastCompleted) - new Date(firstStarted) : null;

                // Conteo/Empaque data from processParameters deduplicated
                let totalPlanned = 0, totalActual = 0, totalDefective = 0, totalProducedGrams = 0;
                const actualsByProduct = {};
                const plannedByProduct = {};
                
                for (const n of notes) {
                    if (n.processType?.code === 'CONTEO' && n.processParameters?.conteo) {
                        for (const [key, data] of Object.entries(n.processParameters.conteo)) {
                            const prodId = data.productId || key;
                            actualsByProduct[prodId] = Math.max(actualsByProduct[prodId] || 0, data.actual || 0);
                            plannedByProduct[prodId] = Math.max(plannedByProduct[prodId] || 0, data.planned || 0);
                        }
                    }
                    if (n.processType?.code === 'EMPAQUE' && n.processParameters?.empaque) {
                        const emp = n.processParameters.empaque;
                        totalDefective += emp.defective_qty || emp.defective || 0;
                        totalProducedGrams += emp.conteo_qty || 0;
                        
                        const actualQty = n.actualQuantity != null ? n.actualQuantity : (emp.approved_qty ?? n.targetQuantity ?? 0);
                        
                        if (n.productId) {
                            actualsByProduct[n.productId] = Math.max(actualsByProduct[n.productId] || 0, actualQty);
                            // Only fallback to targetQuantity if absolutely no plan exists, otherwise it inflates the plan when actuals > planned
                            plannedByProduct[n.productId] = plannedByProduct[n.productId] ? Math.max(plannedByProduct[n.productId], emp.planned_qty || 0) : Math.max(0, emp.planned_qty || n.targetQuantity || 0);
                        } else if (emp.product_id) {
                            actualsByProduct[emp.product_id] = Math.max(actualsByProduct[emp.product_id] || 0, actualQty);
                            plannedByProduct[emp.product_id] = plannedByProduct[emp.product_id] ? Math.max(plannedByProduct[emp.product_id], emp.planned_qty || 0) : Math.max(0, emp.planned_qty || n.targetQuantity || 0);
                        }
                    }
                }
                
                totalActual = Object.values(actualsByProduct).reduce((a, b) => a + b, 0);
                totalPlanned = Object.values(plannedByProduct).reduce((a, b) => a + b, 0);

                const effectiveness = totalActual > 0
                    ? Math.round(((totalActual - totalDefective) / totalActual) * 100) : null;

                return {
                    id: batch.id,
                    batchNumber: batch.batchNumber,
                    flavor: batch.flavor,
                    status: batch.status,
                    product: batch.product?.name,
                    startedAt: firstStarted || batch.startedAt,
                    completedAt: lastCompleted || batch.completedAt,
                    durationMinutes: durationMs ? Math.round(durationMs / 60000) : null,
                    expectedOutput: batch.expectedOutput,
                    actualOutput: batch.actualOutput,
                    stagesTotal: notes.length,
                    stagesCompleted: completed.length,
                    unitsPlanned: totalPlanned,
                    unitsActual: totalActual,
                    unitsDefective: totalDefective,
                    effectiveness,
                    outputTargets: batch.outputTargets?.map(t => ({
                        product: t.product?.name,
                        plannedUnits: plannedByProduct[t.productId] != null && plannedByProduct[t.productId] > 0 ? plannedByProduct[t.productId] : t.plannedUnits,
                        plannedWeightKg: t.plannedWeightKg
                    })),
                    createdAt: batch.createdAt
                };
            });

            res.json({
                data: enriched,
                pagination: {
                    page: parseInt(page),
                    limit: take,
                    total,
                    totalPages: Math.ceil(total / take)
                }
            });
        } catch (error) {
            console.error('[BatchHistory] list error:', error.message);
            res.status(500).json({ error: error.message });
        }
    },

    // ── DETAIL: full timeline with ingredients, lots, operators ──────────────
    detail: async (req, res) => {
        try {
            const { batchId } = req.params;

            const batch = await prisma.productionBatch.findUnique({
                where: { id: batchId },
                include: {
                    product: { select: { id: true, name: true } },
                    outputTargets: {
                        include: { product: { select: { name: true, sku: true } } }
                    },
                    assemblyNotes: {
                        include: {
                            product: { select: { name: true } },
                            processType: { select: { code: true, name: true } },
                            completedBy: { select: { name: true } },
                            items: {
                                include: {
                                    component: { select: { name: true, sku: true, unit: true } }
                                }
                            },
                            qualityChecks: true,
                            processVariables: true
                        },
                        orderBy: { stageOrder: 'asc' }
                    }
                }
            });

            if (!batch) return res.status(404).json({ error: 'Batch not found' });

            // Fetch lot consumptions for this batch
            const noteIds = batch.assemblyNotes.map(n => n.id);
            const lotConsumptions = await prisma.lotConsumption.findMany({
                where: { assemblyNoteId: { in: noteIds } },
                include: {
                    materialLot: {
                        include: {
                            product: { select: { name: true } }
                        }
                    }
                },
                orderBy: { usedAt: 'asc' }
            });

            // Group consumptions by noteId
            const consumptionsByNote = {};
            for (const lc of lotConsumptions) {
                if (!consumptionsByNote[lc.assemblyNoteId]) consumptionsByNote[lc.assemblyNoteId] = [];
                consumptionsByNote[lc.assemblyNoteId].push({
                    product: lc.materialLot?.product?.name,
                    lotNumber: lc.materialLot?.lotNumber,
                    expiresAt: lc.materialLot?.expiresAt,
                    quantityUsed: lc.quantityUsed,
                    unit: lc.materialLot?.unit || 'gramo',
                    usedAt: lc.usedAt,
                    observations: lc.observations
                });
            }

            // Build notes array (needed for production lot query and timeline)
            const notes = batch.assemblyNotes || [];

            // Fetch output production lots created by this batch
            // Strategy: find lots whose productId matches any assembly note product
            // and were created during the batch's time window (no purchaseOrderItemId = production lot)
            const noteProductIds = [...new Set(notes.map(n => n.productId).filter(Boolean))];
            const batchStart = notes.reduce((min, n) =>
                n.startedAt && (!min || n.startedAt < min) ? n.startedAt : min, null);
            const batchEnd = notes.reduce((max, n) =>
                n.completedAt && (!max || n.completedAt > max) ? n.completedAt : max, null);

            let productionLots = [];
            if (noteProductIds.length > 0 && batchStart) {
                productionLots = await prisma.materialLot.findMany({
                    where: {
                        productId: { in: noteProductIds },
                        purchaseOrderItemId: null,
                        receivedAt: {
                            gte: new Date(new Date(batchStart).getTime() - 60000),
                            ...(batchEnd ? { lte: new Date(new Date(batchEnd).getTime() + 60000) } : {})
                        }
                    },
                    include: { product: { select: { name: true } } },
                    orderBy: { receivedAt: 'asc' }
                });
            }

            // Build timeline
            const firstStarted = notes.reduce((min, n) =>
                n.startedAt && (!min || n.startedAt < min) ? n.startedAt : min, null);
            const lastCompleted = notes.reduce((max, n) =>
                n.completedAt && (!max || n.completedAt > max) ? n.completedAt : max, null);
            const durationMs = firstStarted && lastCompleted
                ? new Date(lastCompleted) - new Date(firstStarted) : null;

            const timeline = notes.map(note => {
                const noteDuration = note.startedAt && note.completedAt
                    ? Math.round((new Date(note.completedAt) - new Date(note.startedAt)) / 60000) : null;

                // Extract photos from processParameters
                const photos = [];
                const pp = note.processParameters || {};
                // QC verification photo
                if (pp.qc_result?.verificationPhoto) photos.push({ url: pp.qc_result.verificationPhoto, label: 'Verificación QC' });
                // QC individual photos
                if (pp.qc_result?.photos) {
                    Object.entries(pp.qc_result.photos).forEach(([key, url]) => {
                        if (url) photos.push({ url, label: key });
                    });
                }
                // Cocción / Timer photos (temperature validation)
                if (pp.timerState?.photoUrl) photos.push({ url: pp.timerState.photoUrl, label: '🌡️ Foto Temperatura' });
                if (pp.coccion_result?.photoUrl && pp.coccion_result.photoUrl !== pp.timerState?.photoUrl) {
                    photos.push({ url: pp.coccion_result.photoUrl, label: '🌡️ Cocción Completada' });
                }
                // Empaque photos
                if (pp.empaque?.photo_urls?.length > 0) {
                    pp.empaque.photo_urls.forEach((url, i) => photos.push({ url, label: `Empaque ${i + 1}` }));
                }
                
                // Weighing (pesaje) photos for ingredients - LIQUIPOPS and GENERAL
                if (pp.weighing_photos) {
                    Object.entries(pp.weighing_photos).forEach(([itemId, url]) => {
                        if (url) {
                            // Try to find the ingredient name from the items array to use as label
                            const item = (note.items || []).find(i => i.id === itemId);
                            const label = item?.component?.name ? `Pesaje: ${item.component.name}` : `Pesaje Insumo`;
                            photos.push({ url, label });
                        }
                    });
                }
                
                // Weighing (pesaje) photos for ingredients - GENIALITY
                if (pp.weighing_data) {
                    Object.entries(pp.weighing_data).forEach(([itemId, data]) => {
                        if (data.photoUrl) {
                            const item = (note.items || []).find(i => i.id === itemId);
                            const label = item?.component?.name ? `Pesaje: ${item.component.name}` : `Pesaje Insumo`;
                            photos.push({ url: data.photoUrl, label });
                        }
                    });
                }
                // Temperature & sensory data from QC or cocción
                const temperature = pp.coccion_result?.realTemperature || pp.qc_result?.temperature || null;
                const targetTemperature = pp.coccion_result?.targetTemperature || pp.targetTemperature || null;
                const timerCompleted = pp.coccion_result?.timerCompleted ?? null;
                const sensoryChecks = pp.qc_result?.sensoryChecks || null;

                return {
                    id: note.id,
                    stageOrder: note.stageOrder,
                    stageName: note.stageName,
                    processType: note.processType?.code,
                    processTypeName: note.processType?.name,
                    status: note.status,
                    operator: note.completedBy?.name || null,
                    startedAt: note.startedAt,
                    completedAt: note.completedAt,
                    durationMinutes: noteDuration,
                    targetQuantity: note.targetQuantity,
                    actualQuantity: note.actualQuantity,
                    observations: note.observations,
                    processParameters: note.processParameters,
                    photos,
                    temperature,
                    targetTemperature,
                    timerCompleted,
                    sensoryChecks,
                    ingredients: (note.items || []).map(item => ({
                        name: item.component?.name,
                        plannedQuantity: item.plannedQuantity,
                        actualQuantity: item.actualQuantity,
                        unit: item.unit,
                        lotNumber: item.lotNumber,
                        consumed: item.consumed,
                        consumedAt: item.consumedAt
                    })),
                    lotConsumptions: consumptionsByNote[note.id] || [],
                    qualityChecks: (note.qualityChecks || []).map(qc => ({
                        parameterName: qc.parameterName,
                        value: qc.value,
                        unit: qc.unit,
                        passed: qc.passed,
                        checkedAt: qc.checkedAt
                    })),
                    processVariables: (note.processVariables || []).map(pv => ({
                        name: pv.name,
                        value: pv.value,
                        unit: pv.unit,
                        recordedAt: pv.recordedAt
                    }))
                };
            });

            // Conteo/empaque summary deduplicated by product size
            let unitsPlanned = 0, unitsActual = 0, totalDefective = 0;
            const actualsByProduct = {};
            const plannedByProduct = {};
            
            for (const n of notes) {
                if (n.processType?.code === 'CONTEO' && n.processParameters?.conteo) {
                    for (const [key, data] of Object.entries(n.processParameters.conteo)) {
                        const prodId = data.productId || key;
                        actualsByProduct[prodId] = data.actual || 0;
                        plannedByProduct[prodId] = data.planned || 0;
                    }
                }
                if (n.processType?.code === 'EMPAQUE') {
                    const emp = n.processParameters?.empaque || {};
                    totalDefective += emp.defective_qty || emp.defective || 0;
                    
                    const actualQty = n.actualQuantity != null ? n.actualQuantity : (emp.approved_qty ?? n.targetQuantity ?? 0);
                    
                    if (n.productId) {
                        actualsByProduct[n.productId] = Math.max(actualsByProduct[n.productId] || 0, actualQty);
                        plannedByProduct[n.productId] = plannedByProduct[n.productId] ? Math.max(plannedByProduct[n.productId], emp.planned_qty || 0) : Math.max(0, emp.planned_qty || n.targetQuantity || 0);
                    } else if (emp.product_id) { // fallback
                        actualsByProduct[emp.product_id] = Math.max(actualsByProduct[emp.product_id] || 0, actualQty);
                        plannedByProduct[emp.product_id] = plannedByProduct[emp.product_id] ? Math.max(plannedByProduct[emp.product_id], emp.planned_qty || 0) : Math.max(0, emp.planned_qty || n.targetQuantity || 0);
                    }
                }
            }

            for (const c of Object.values(actualsByProduct)) unitsActual += c;
            for (const c of Object.values(plannedByProduct)) unitsPlanned += c;

            // ── FILLING KPI (Geniality only) ─────────────────────────────────
            // Detect Geniality batch: has EMPAQUE notes (carriots-based)
            let fillingKpi = null;
            const empaqueNotes = notes.filter(n => n.processType?.code === 'EMPAQUE');
            if (empaqueNotes.length > 0 && batch.batchNumber) {
                try {
                    // Saborizacion g per unit from Formula table
                    const SAB_PER_UNIT = { '1000': 1350, '360': 500, 'default': 1350 };

                    // Consumption from the batch's OWN saborizacion lot only
                    // The saborizacion lot for this batch has lotNumber === batch.batchNumber
                    const sabLot = await prisma.materialLot.findFirst({
                        where: {
                            lotNumber: batch.batchNumber,
                            siigoProductName: { contains: 'SABORIZACION', mode: 'insensitive' }
                        },
                        select: { id: true, initialQuantity: true, siigoProductName: true }
                    });

                    if (sabLot) {
                        // Total consumed from this batch's saborizacion lot
                        const sabLCs = await prisma.lotConsumption.findMany({
                            where: { materialLotId: sabLot.id, assemblyNoteId: { in: noteIds } }
                        });
                        const actualConsumed = sabLCs.reduce((s, lc) => s + lc.quantityUsed, 0);

                        // Expected: for each EMPAQUE note, get unit count and product size
                        let expectedConsumed = 0;
                        const breakdown = [];
                        for (const en of empaqueNotes) {
                            const unitCount = en.targetQuantity || 0;
                            if (unitCount <= 0) continue;
                            // Detect size from stage name ("1000 ML" or "360 ML")
                            const stageName = en.stageName || '';
                            const size = stageName.includes('1000') ? '1000' : stageName.includes('360') ? '360' : 'default';
                            const gpv = SAB_PER_UNIT[size];
                            const expected = unitCount * gpv;
                            expectedConsumed += expected;
                            breakdown.push({ stageName, unitCount, gpv, expected });
                        }

                        if (expectedConsumed > 0) {
                            const mermaG = actualConsumed - expectedConsumed;
                            const mermaP = Math.round((mermaG / expectedConsumed) * 1000) / 10; // 1 decimal
                            const potentialExtra1000 = Math.floor(mermaG / 1350);
                            const potentialExtra360 = Math.floor(mermaG / 500);
                            const pricePer1000 = 27000; // COP
                            const revenuePotential = potentialExtra1000 * pricePer1000;

                            fillingKpi = {
                                productionG: Math.round(sabLot.initialQuantity),
                                actualConsumedG: Math.round(actualConsumed),
                                expectedConsumedG: Math.round(expectedConsumed),
                                mermaG: Math.round(mermaG),
                                mermaPct: mermaP,
                                potentialExtra1000,
                                potentialExtra360,
                                revenuePotential,
                                breakdown
                            };
                        }
                    }
                } catch (e) {
                    console.warn('[fillingKpi] calc error:', e.message);
                }
            }

            const enrichedProductionLots = await Promise.all(productionLots.map(async lot => {
                const intern = await prisma.lotConsumption.findMany({
                    where: { materialLotId: lot.id },
                    include: { assemblyNote: { select: { productionBatch: { select: { batchNumber: true, flavor: true, product: true } } } } }
                });
                const extern = await prisma.orderPickingItem.findMany({
                    where: { lotNumber: lot.lotNumber },
                    include: { orderItem: { select: { order: { select: { orderNumber: true, distributor: { select: { name: true } } } } } } }
                });

                return {
                    lotNumber: lot.lotNumber,
                    product: lot.product?.name,
                    initialQuantity: lot.initialQuantity,
                    currentQuantity: lot.currentQuantity,
                    status: lot.status,
                    expiresAt: lot.expiresAt,
                    receivedAt: lot.receivedAt,
                    internalUses: intern.map(i => ({
                        quantity: i.quantityUsed,
                        batchNumber: i.assemblyNote?.productionBatch?.batchNumber
                    })),
                    externalUses: extern.map(e => ({
                        quantity: e.scannedQty,
                        orderNumber: e.orderItem?.order?.orderNumber,
                        clientName: e.orderItem?.order?.distributor?.name
                    }))
                };
            }));

            const calcActualOutput = productionLots.reduce((acc, lot) => acc + lot.initialQuantity, 0);
            const finalActualOutput = batch.actualOutput || calcActualOutput;

            const enrichedOutputTargets = batch.outputTargets?.map(t => {
                return {
                    productId: t.productId,
                    product: t.product?.name,
                    sku: t.product?.sku,
                    plannedUnits: plannedByProduct[t.productId] != null && plannedByProduct[t.productId] > 0 ? plannedByProduct[t.productId] : t.plannedUnits,
                    actualUnits: actualsByProduct[t.productId] || t.actualUnits || 0,
                    plannedWeightKg: t.plannedWeightKg
                };
            }) || [];

            res.json({
                id: batch.id,
                batchNumber: batch.batchNumber,
                flavor: batch.flavor,
                status: batch.status,
                product: batch.product?.name,
                startedAt: firstStarted || batch.startedAt,
                completedAt: lastCompleted || batch.completedAt,
                durationMinutes: durationMs ? Math.round(durationMs / 60000) : null,
                expectedOutput: batch.expectedOutput,
                actualOutput: finalActualOutput,
                calculatedActualOutput: calcActualOutput,
                notes: batch.notes,
                kpis: {
                    stagesTotal: notes.length,
                    stagesCompleted: notes.filter(n => n.status === 'COMPLETED').length,
                    unitsPlanned,
                    unitsActual,
                    unitsDefective: totalDefective,
                    unitsApproved: unitsActual - totalDefective,
                    effectiveness: unitsActual > 0
                        ? Math.round(((unitsActual - totalDefective) / unitsActual) * 100) : null
                },
                outputTargets: enrichedOutputTargets,
                timeline,
                fillingKpi,
                productionLots: enrichedProductionLots,
                createdAt: batch.createdAt
            });
        } catch (error) {
            console.error('[BatchHistory] detail error:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
};

module.exports = batchHistoryController;
