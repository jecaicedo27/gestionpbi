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

                // Conteo/Empaque data from processParameters
                let totalPlanned = 0, totalActual = 0, totalDefective = 0, totalProducedGrams = 0;
                for (const n of notes) {
                    if (n.processType?.code === 'CONTEO' && n.processParameters?.conteo) {
                        for (const [, data] of Object.entries(n.processParameters.conteo)) {
                            totalPlanned += data.planned || 0;
                            totalActual += data.actual || 0;
                        }
                    }
                    if (n.processType?.code === 'EMPAQUE' && n.processParameters?.empaque) {
                        const emp = n.processParameters.empaque;
                        // targetQuantity has the unit count (71, 13), conteo_qty has grams
                        totalActual += n.targetQuantity || 0;
                        totalPlanned += n.targetQuantity || 0;
                        totalDefective += emp.defective_qty || emp.defective || 0;
                        totalProducedGrams += emp.conteo_qty || 0;
                    }
                }

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
                        plannedUnits: t.plannedUnits,
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

            // Conteo/empaque summary
            let unitsPlanned = 0, unitsActual = 0, totalDefective = 0;
            for (const n of notes) {
                if (n.processType?.code === 'CONTEO' && n.processParameters?.conteo) {
                    for (const [, data] of Object.entries(n.processParameters.conteo)) {
                        unitsPlanned += data.planned || 0;
                        unitsActual += data.actual || 0;
                    }
                }
                if (n.processType?.code === 'EMPAQUE' && n.processParameters?.empaque) {
                    const emp = n.processParameters.empaque;
                    // targetQuantity has the unit count (71, 13), conteo_qty has grams
                    unitsActual += n.targetQuantity || 0;
                    unitsPlanned += n.targetQuantity || 0;
                    totalDefective += emp.defective_qty || emp.defective || 0;
                }
            }

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
                actualOutput: batch.actualOutput,
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
                outputTargets: batch.outputTargets?.map(t => ({
                    product: t.product?.name,
                    sku: t.product?.sku,
                    plannedUnits: t.plannedUnits,
                    plannedWeightKg: t.plannedWeightKg
                })),
                timeline,
                productionLots: productionLots.map(lot => ({
                    lotNumber: lot.lotNumber,
                    product: lot.product?.name,
                    initialQuantity: lot.initialQuantity,
                    currentQuantity: lot.currentQuantity,
                    status: lot.status,
                    expiresAt: lot.expiresAt,
                    receivedAt: lot.receivedAt
                })),
                createdAt: batch.createdAt
            });
        } catch (error) {
            console.error('[BatchHistory] detail error:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
};

module.exports = batchHistoryController;
