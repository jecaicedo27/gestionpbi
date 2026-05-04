const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const assemblyService = require('../services/genialityAssemblyService');

// Strip accents for flavor-insensitive matching (CAFE ↔ CAFÉ)
const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Controller for Assembly Notes (Execution)
 */
const assemblyNoteController = {
    /**
     * List all assembly notes with filters
     */
    getAllNotes: async (req, res) => {
        try {
            const { status, batchId, productId } = req.query;
            const where = {};
            if (status) where.status = status;
            if (batchId) where.productionBatchId = batchId;
            if (productId) where.productId = productId;

            const notes = await prisma.assemblyNote.findMany({
                where,
                include: {
                    product: true,
                    productionBatch: { include: { outputTargets: { include: { product: { select: { id: true, name: true, sku: true, size: true } } }, orderBy: { plannedWeightKg: 'desc' } } } },

                    executedBy: true,
                    processType: true,
                    items: { include: { component: true } }
                },
                orderBy: { stageOrder: 'asc' }
            });

            // Defense-in-depth: filter out Liquipops notes that may share the same batchId.
            // Geniality products use accountGroups 1402/1405; CONTEO is shared (no product filter).
            const GENIALITY_GROUPS = [1402, 1405];
            const filtered = notes.filter(n => {
                const code = n.processType?.code;
                // Shared step types allowed for both lines
                if (code === 'CONTEO') return true;
                // Geniality-prefixed process types always allowed
                if (code?.startsWith('G_')) return true;
                // Check product account group (siropes = 1402/1405)
                const ag = n.product?.accountGroup;
                if (ag && GENIALITY_GROUPS.includes(ag)) return true;
                // Check product name contains SIROPE or GENIALITY
                const pName = (n.product?.name || '').toUpperCase();
                if (pName.includes('SIROPE') || pName.includes('GENIALITY')) return true;
                // Reject — likely a Liquipops note
                return false;
            });

            res.json(filtered);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * Get a single note with its items and process info.
     * For PENDING notes: recalculates plannedQuantity live from the current template
     * so that template changes propagate to all pending scheduled batches automatically.
     * Completed/executing notes keep stored values for audit trail.
     */
    getNoteById: async (req, res) => {
        try {
            const { id } = req.params;
            const note = await prisma.assemblyNote.findUnique({
                where: { id },
                include: {
                    items: {
                        include: { component: true },
                        orderBy: { createdAt: 'asc' }
                    },
                    processVariables: true,
                    qualityChecks: true,
                    product: {
                        include: {
                            formulas: {
                                where: { isActive: true },
                                include: {
                                    items: {
                                        include: { ingredient: true },
                                        orderBy: { additionOrder: 'asc' }
                                    }
                                }
                            }
                        }
                    },
                    productionBatch: { include: { outputTargets: { include: { product: { select: { id: true, name: true, sku: true, size: true } } }, orderBy: { plannedWeightKg: 'desc' } } } },
                    executedBy: true,
                    processType: true
                }
            });
            if (!note) return res.status(404).json({ error: 'Note not found' });

            // ── Live recalculation for PENDING notes ──────────────────────────────
            // If the note is pending AND we know the template stage, recalculate
            // plannedQuantity from the current template inputs so template changes
            // propagate automatically to all scheduled (not yet started) batches.
            const processCode = note.processType?.code;
            const isFormacionNote = ['FORMACION', 'G_FORMACION'].includes(processCode);
            if (note.status === 'PENDING' && note.stageId && note.targetQuantity && !isFormacionNote) {
                const templateInputs = await prisma.assemblyTemplateStageInput.findMany({
                    where: { stageId: note.stageId },
                    include: { product: { select: { id: true, name: true, sku: true } } },
                    orderBy: { displayOrder: 'asc' }
                });

                if (templateInputs.length > 0) {
                    // Build lookup: productId → array of { qpu, unit, product }
                    const qpuMap = {};
                    for (const ti of templateInputs) {
                        if (!qpuMap[ti.productId]) qpuMap[ti.productId] = [];
                        qpuMap[ti.productId].push({ qpu: ti.quantityPerUnit, unit: ti.unit, product: ti.product });
                    }

                    // For PESAJE: SKIP recalculation — quickStart already computed correct
                    // scaled values (handles both absolute and per-gram ratio inputs).
                    // For ENSAMBLE: SKIP recalculation — template quantityPerUnit stores
                    // absolute grams (already scaled), NOT per-unit ratios. Multiplying
                    // again by targetQuantity would produce wildly inflated values.
                    // Live recalc would lose the scaling and show raw template values.
                    const isPesajeNote = ['PESAJE', 'G_PESAJE'].includes(processCode);
                    const isEnsambleNote = ['ENSAMBLE', 'G_ENSAMBLE'].includes(processCode);
                    if (isPesajeNote || isEnsambleNote) {
                        // Keep stored DB values — they are already correct
                        // Just re-sort items to match template order (below)
                    } else {
                        const qpuConsumed = {};
                        note.items = note.items.map(item => {
                            const arr = qpuMap[item.componentId];
                            if (arr && arr.length > 0) {
                                const consumedIdx = qpuConsumed[item.componentId] || 0;
                                const current = arr[consumedIdx] || arr[arr.length - 1]; // fallback to last if mismatch
                                qpuConsumed[item.componentId] = consumedIdx + 1;

                                return {
                                    ...item,
                                    plannedQuantity: current.qpu * note.targetQuantity,
                                    unit: current.unit || item.unit,
                                    _recalculated: true
                                };
                            }
                            return item;
                        });
                    } // end: else (skip PESAJE recalc)

                    // ── Inject template items added AFTER the note was generated ─────
                    // If the template has a new input (e.g. TARRO added later), it won't
                    // have an AssemblyNoteItem yet. We inject it as a virtual item so the
                    // operator sees it with its planned quantity (no DB write, read-only display).
                    // Skip for PESAJE — quickStart creates all items with correct scaling.
                    const existingComponentIds = new Set(note.items.map(i => i.componentId));
                    // Skip virtual item injection for flavor-substituted notes, PESAJE, or ENSAMBLE
                    // (their items intentionally differ from the template inputs)
                    const isFlavorSubstituted = note.processParameters?.flavorKey;
                    if (!isFlavorSubstituted && !isPesajeNote && !isEnsambleNote) {
                        for (const ti of templateInputs) {
                            if (!existingComponentIds.has(ti.productId)) {
                                note.items.unshift({
                                    id: `virtual_${ti.id}`,
                                    componentId: ti.productId,
                                    component: ti.product,
                                    plannedQuantity: isPesajeNote ? ti.quantityPerUnit : ti.quantityPerUnit * note.targetQuantity,
                                    actualQuantity: null,
                                    unit: ti.unit,
                                    lotNumber: null,
                                    _virtual: true,       // signals UI this is a template-only item
                                    _recalculated: true,
                                    createdAt: new Date(0) // sort first
                                });
                            }
                        }
                    }
                    // Re-sort to match template displayOrder
                    // Use array of orders per productId to handle duplicate ingredients
                    const displayOrderArrays = {};
                    templateInputs.forEach((ti, idx) => {
                        const key = ti.productId;
                        if (!displayOrderArrays[key]) displayOrderArrays[key] = [];
                        displayOrderArrays[key].push(ti.displayOrder ?? idx);
                    });
                    // Track consumption index per productId
                    const displayConsumed = {};
                    // Pre-assign each item its own displayOrder before sorting
                    note.items.forEach(item => {
                        const key = item.componentId;
                        const arr = displayOrderArrays[key];
                        if (arr) {
                            const idx = displayConsumed[key] || 0;
                            item._sortOrder = arr[idx] ?? arr[arr.length - 1] ?? 999;
                            displayConsumed[key] = idx + 1;
                        } else {
                            item._sortOrder = 999;
                        }
                        // Exponer al frontend para que respete el orden de la
                        // fórmula al renderizar (PesajeBatchStep / AdicionBatchStep).
                        item.displayOrder = item._sortOrder === 999 ? null : item._sortOrder;
                    });
                    note.items.sort((a, b) => a._sortOrder - b._sortOrder);
                }
            }

            // ── Dynamic item ordering from formula (ALL statuses) ─────────────────
            // Always sort items by the formula's current additionOrder, so changes
            // to formula ingredient order propagate to ALL batches immediately
            // without needing to delete/recreate them.
            // Uses arrays per ingredientId to handle duplicate ingredients (e.g.,
            // AZUCAR INVERTER GLUCOSA split into two halves at different positions).
            const activeFormula = note.product?.formulas?.[0];
            if (activeFormula?.items?.length > 0) {
                const formulaOrderArrays = {};
                activeFormula.items.forEach(fi => {
                    const key = fi.ingredientId;
                    if (!formulaOrderArrays[key]) formulaOrderArrays[key] = [];
                    formulaOrderArrays[key].push(fi.additionOrder ?? 999);
                });
                // Track consumption index per ingredientId
                const formulaConsumed = {};
                note.items.forEach(item => {
                    const key = item.componentId;
                    const arr = formulaOrderArrays[key];
                    if (arr) {
                        const idx = formulaConsumed[key] || 0;
                        item._formulaOrder = arr[idx] ?? arr[arr.length - 1] ?? 999;
                        formulaConsumed[key] = idx + 1;
                    } else {
                        item._formulaOrder = 999;
                    }
                    // Exponer al frontend para que respete el orden de la
                    // fórmula al renderizar (PesajeBatchStep / AdicionBatchStep).
                    item.displayOrder = item._formulaOrder === 999 ? null : item._formulaOrder;
                });
                note.items.sort((a, b) => (a._formulaOrder) - (b._formulaOrder));
            }

            // ── FORMACION: use formula values directly for correct quantities ──
            // The formula stores absolute per-batch quantities (e.g., ALGINATO=44,160g,
            // COMPUESTO=122,518g). No scaling needed — just use formula values.
            // Also update targetQuantity to formula's baseQuantity for correct META.
            if (note.processType?.code === 'FORMACION' && note.status === 'PENDING') {
                const formacionFormula = await prisma.formula.findFirst({
                    where: { productId: note.productId, isActive: true },
                    include: { items: { include: { ingredient: { select: { id: true, name: true } } } } },
                    orderBy: { version: 'desc' }
                });

                if (formacionFormula) {
                    // Override targetQuantity with formula baseQuantity
                    note.targetQuantity = formacionFormula.baseQuantity || note.targetQuantity;
                    note.unit = formacionFormula.baseUnit || note.unit;

                    // Map formula items by ingredientId for lookup
                    const formulaMap = {};
                    formacionFormula.items.forEach(fi => {
                        formulaMap[fi.ingredientId] = fi.quantity;
                    });

                    // Update each item's plannedQuantity from formula
                    note.items = note.items.map(item => {
                        const formulaQty = formulaMap[item.componentId];
                        return {
                            ...item,
                            plannedQuantity: formulaQty != null ? formulaQty : item.plannedQuantity,
                            _fromFormula: true
                        };
                    });

                    // Find COMPUESTO actual for frontend reference
                    const compuestoNote = await prisma.assemblyNote.findFirst({
                        where: {
                            productionBatchId: note.productionBatchId,
                            status: 'COMPLETED',
                            product: { name: { contains: 'COMPUESTO', mode: 'insensitive' } }
                        },
                        select: { actualQuantity: true },
                        orderBy: { stageOrder: 'desc' }
                    });
                    if (compuestoNote?.actualQuantity) {
                        note.compuestoActualQty = compuestoNote.actualQuantity;
                    }
                }
            }
            // ── GENERAL: inject FROM_PREVIOUS_STAGE inputs from preceding note ─────
            // For any PENDING note: if the template has inputs of type FROM_PREVIOUS_STAGE,
            // look up the preceding stage note (stageOrder - 1) from the same batch.
            // If it is COMPLETED and has actualQuantity, use that as the plannedQuantity.
            // Covers: Stage 5 Ensamble ESFERAS ← Stage 4 actualQty (esferas produced),
            //         and future multi-stage chains.
            if (note.status === 'PENDING' && note.stageId) {
                const stageInputs = await prisma.assemblyTemplateStageInput.findMany({
                    where: { stageId: note.stageId, inputType: 'FROM_PREVIOUS_STAGE' },
                    select: { productId: true, quantityPerUnit: true }
                });

                if (stageInputs.length > 0) {
                    const prevNote = await prisma.assemblyNote.findFirst({
                        where: {
                            productionBatchId: note.productionBatchId,
                            stageOrder: note.stageOrder - 1,
                            status: 'COMPLETED'
                        },
                        select: { actualQuantity: true }
                    });

                    if (prevNote?.actualQuantity) {
                        const fromPrevIds = new Set(stageInputs.map(ti => ti.productId));
                        note.items = note.items.map(item => {
                            if (fromPrevIds.has(item.componentId)) {
                                return {
                                    ...item,
                                    plannedQuantity: prevNote.actualQuantity,
                                    _fromPreviousStage: true
                                };
                            }
                            return item;
                        });
                    }
                }
            }
            // ─────────────────────────────────────────────────────────────────────
            // ── EMPAQUE: inject CONTEO actual counts for the matching product ─────
            // For PENDING EMPAQUE notes: look up the CONTEO note from the same batch
            // and inject the actual count for the product in this EMPAQUE stage so
            // the frontend can show 'Producción Real' and calculate aprobados = conteo - defectos.
            if (note.processType?.code === 'EMPAQUE' && ['PENDING', 'EXECUTING'].includes(note.status)) {
                const conteoNote = await prisma.assemblyNote.findFirst({
                    where: {
                        productionBatchId: note.productionBatchId,
                        processType: { code: 'CONTEO' },
                        status: 'COMPLETED'
                    },
                    select: { id: true, processParameters: true }
                });
                if (conteoNote?.processParameters) {
                    const productId = note.processParameters?.product_id || note.productId;
                    // processParameters.conteo is keyed by product name with { productId, actual, planned, ... }
                    const conteoMap = conteoNote.processParameters?.conteo || {};
                    const conteoEntry = Object.values(conteoMap).find(v => v?.productId === productId);
                    const conteoQty = conteoEntry?.actual ?? null;
                    // Also get planned from outputTargets
                    const outputTarget = (note.productionBatch?.outputTargets || []).find(t => t.productId === productId);
                    note.empaqueData = {
                        conteo_qty: conteoQty,
                        planned_qty: outputTarget?.plannedUnits ?? null,
                        product_id: productId,
                        product_name: conteoEntry?.productName || note.product?.name
                    };
                }
            }
            // ─────────────────────────────────────────────────────────────────────

            res.json(note);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * Trigger generation of notes for a batch
     */
    generateForBatch: async (req, res) => {
        try {
            const { batchId, templateId } = req.body;
            const result = await assemblyService.generateNotesForBatch(batchId, templateId || null);
            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    },

    /**
     * Validate material availability for a note
     */
    validateMaterials: async (req, res) => {
        try {
            const { id } = req.params;
            const result = await assemblyService.validateMaterialAvailability(id);
            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    },

    /**
     * Start a note (consume inventory, set status to EXECUTING)
     */
    startNote: async (req, res) => {
        try {
            const { id } = req.params;
            const operatorId = req.body.operatorId || req.user?.id;

            // ── Role restriction on START: only OPERARIO_PICKING / ADMIN can start EMPAQUE / final ENSAMBLE ──
            // Final ENSAMBLE = comes AFTER EMPAQUE steps in the same batch
            const noteForStart = await prisma.assemblyNote.findUnique({
                where: { id },
                select: { processType: { select: { code: true } }, stageOrder: true, productionBatchId: true }
            });
            const startStageCode = noteForStart?.processType?.code;
            const startRole = req.user?.role;
            let startRestricted = startStageCode === 'EMPAQUE';
            if (startStageCode === 'ENSAMBLE') {
                const empBefore = await prisma.assemblyNote.count({
                    where: {
                        productionBatchId: noteForStart.productionBatchId,
                        processType: { code: 'EMPAQUE' },
                        stageOrder: { lt: noteForStart.stageOrder }
                    }
                });
                startRestricted = empBefore > 0;
            }
            if (startRestricted && startRole && !['OPERARIO_PICKING', 'ADMIN'].includes(startRole)) {
                console.log(`[startNote] ⛔ BLOCKED — role ${startRole} cannot start ${startStageCode} stage (post-empaque)`);
                return res.status(403).json({ error: `Solo el rol EMPAQUE (OPERARIO_PICKING) puede iniciar etapas de ${startStageCode}` });
            }

            const result = await assemblyService.consumeMaterialsAndStart(id, operatorId);
            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    },

    /**
     * Update note fields (processParameters for CONTEO step actuals)
     */
    updateNote: async (req, res) => {
        try {
            const { id } = req.params;
            const { processParameters } = req.body;
            const updated = await prisma.assemblyNote.update({
                where: { id },
                data: { ...(processParameters !== undefined && { processParameters }) }
            });
            res.json(updated);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * Record actual quantity and lot number for a specific input item
     */
    updateItemActualQty: async (req, res) => {
        try {
            const { id, itemId } = req.params;
            const { actualQuantity, lotNumber } = req.body;
            const operatorId = req.body.operatorId || req.user?.id;

            const result = await assemblyService.recordActualQuantity(id, itemId, actualQuantity, operatorId, lotNumber);
            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    },

    /**
     * Record a process variable (temperature, pH, brix, etc.)
     */
    recordVariable: async (req, res) => {
        try {
            const { id } = req.params;
            const operatorId = req.body.operatorId || req.user?.id;
            const { name, value, unit } = req.body;

            const variable = await prisma.assemblyProcessVariable.create({
                data: {
                    assemblyNoteId: id,
                    variableName: name,
                    variableValue: String(value),
                    variableUnit: unit || null,
                    capturedById: operatorId
                }
            });
            res.json(variable);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * Complete a note — records actual output, updates inventory, optionally posts to Siigo
     */
    completeNote: async (req, res) => {
        try {
            const { id } = req.params;
            const { actualQuantity, observations, lotSelections } = req.body;
            const operatorId = req.body.operatorId || req.user?.id;
            console.log(`[completeNote] 🎯 ENTRY — noteId=${id}, actualQuantity=${actualQuantity}, operatorId=${operatorId}`);

            // ── Role restriction: only OPERARIO_PICKING / ADMIN can complete EMPAQUE / final ENSAMBLE ──
            // Final ENSAMBLE = one that comes AFTER EMPAQUE stages in the same batch (product final)
            // All other ENSAMBLE (BASE, COMPUESTO, PROTONICO, SIROPE) = production, allowed for all
            const noteForRoleCheck = await prisma.assemblyNote.findUnique({
                where: { id },
                select: { processType: { select: { code: true } }, stageOrder: true, productionBatchId: true }
            });
            const stageCode = noteForRoleCheck?.processType?.code;
            const callerRole = req.user?.role;
            let isRestricted = stageCode === 'EMPAQUE';
            if (stageCode === 'ENSAMBLE') {
                // Check if there are EMPAQUE siblings with lower stageOrder → this is a post-empaque ENSAMBLE
                const empaqueBeforeCount = await prisma.assemblyNote.count({
                    where: {
                        productionBatchId: noteForRoleCheck.productionBatchId,
                        processType: { code: 'EMPAQUE' },
                        stageOrder: { lt: noteForRoleCheck.stageOrder }
                    }
                });
                isRestricted = empaqueBeforeCount > 0;
            }
            const allowedRoles = ['OPERARIO_PICKING', 'ADMIN'];
            if (isRestricted && callerRole && !allowedRoles.includes(callerRole)) {
                console.log(`[completeNote] ⛔ BLOCKED — role ${callerRole} cannot complete ${stageCode} stage (post-empaque: ${isRestricted})`);
                return res.status(403).json({ error: `Solo el rol EMPAQUE (OPERARIO_PICKING) puede finalizar etapas de ${stageCode}` });
            }

            const result = await assemblyService.completeNote(id, {
                actualQuantity: parseFloat(actualQuantity) || 0,
                observations,
                operatorId,
                lotSelections: lotSelections || null
            });

            // ── Post-CONTEO: update EMPAQUE/ENSAMBLE with actual counts ──
            // "No se ensambla lo que se programa, se ensambla lo que sale real"
            try {
                const completedNote = await prisma.assemblyNote.findUnique({
                    where: { id },
                    select: { processType: { select: { code: true } }, productionBatchId: true, processParameters: true }
                });

                if (completedNote?.processType?.code === 'CONTEO' && completedNote.processParameters?.conteo) {
                    const conteo = completedNote.processParameters.conteo;
                    // Build map: productId → actual count
                    const actualByProductId = {};
                    for (const [, data] of Object.entries(conteo)) {
                        if (data.productId && data.actual != null) {
                            actualByProductId[data.productId] = data.actual;
                        }
                    }

                    // Find sibling EMPAQUE/ENSAMBLE notes in the same batch
                    const siblingNotes = await prisma.assemblyNote.findMany({
                        where: {
                            productionBatchId: completedNote.productionBatchId,
                            processType: { code: { in: ['EMPAQUE', 'ENSAMBLE'] } },
                            status: 'PENDING'
                        },
                        include: { items: { include: { component: true } } }
                    });

                    for (const sibling of siblingNotes) {
                        const actualCount = actualByProductId[sibling.productId];
                        if (!actualCount || actualCount <= 0) continue;

                        const oldTarget = sibling.targetQuantity || 0;
                        if (oldTarget <= 0) continue;

                        const scaleFactor = actualCount / oldTarget;

                        const noteProcessType = await prisma.processType.findUnique({
                            where: { id: sibling.processTypeId }, select: { code: true }
                        });
                        const isEmpaque = noteProcessType?.code === 'EMPAQUE';

                        // Update targetQuantity (skip if scale is ~1 for non-EMPAQUE)
                        if (Math.abs(scaleFactor - 1) >= 0.001) {
                            await prisma.assemblyNote.update({
                                where: { id: sibling.id },
                                data: { targetQuantity: actualCount }
                            });
                        }

                        // Scale EMPAQUE items by conteo actual (but do NOT consume inventory here).
                        // Inventory consumption happens when EMPAQUE itself completes via
                        // assemblyService.js auto-consume logic. Pre-consuming here caused
                        // double-deduction bugs and premature stock depletion.
                        if (isEmpaque) {
                            for (const item of sibling.items) {
                                const pq = item.plannedQuantity;
                                if (pq == null || pq <= 0) continue;

                                // Scale quantity by conteo actual
                                const scaledQty = Math.abs(scaleFactor - 1) < 0.001 ? pq : pq * scaleFactor;

                                // Update plannedQuantity + set actualQuantity = planned (auto-filled)
                                await prisma.assemblyNoteItem.update({
                                    where: { id: item.id },
                                    data: {
                                        plannedQuantity: scaledQty,
                                        actualQuantity: scaledQty
                                    }
                                });
                            }

                            // Store conteo reference data inside processParameters (empaqueData is not a DB column)
                            const existingParams = sibling.processParameters || {};
                            await prisma.assemblyNote.update({
                                where: { id: sibling.id },
                                data: {
                                    processParameters: {
                                        ...existingParams,
                                        empaqueRef: {
                                            ...(existingParams.empaqueRef || {}),
                                            conteo_qty: actualCount,
                                            planned_qty: oldTarget
                                        }
                                    }
                                }
                            });

                            console.log(`[completeNote] CONTEO → EMPAQUE scaled ${sibling.stageName}: ${sibling.items.length} items. Scale: ${scaleFactor.toFixed(3)} (consumption deferred to EMPAQUE completion)`);
                        } else {
                            // ENSAMBLE: just log the scale update
                            console.log(`[completeNote] CONTEO → Updated ${sibling.stageName}: target ${oldTarget} → ${actualCount} (×${scaleFactor.toFixed(3)}) [${noteProcessType?.code}]`);
                        }
                    }
                }

                // ── Post-EMPAQUE (no CONTEO): scale ENSAMBLE items by actual production ──
                // SIROPES have no CONTEO step. When EMPAQUE completes, we must scale
                // sibling ENSAMBLE notes to match actual approved units, not planned.
                // "No se ensambla lo que se programa, se ensambla lo que sale real"
                if (completedNote?.processType?.code === 'EMPAQUE') {
                    // Check if there's a CONTEO in this batch — if yes, CONTEO already handled scaling
                    const conteoExists = await prisma.assemblyNote.count({
                        where: {
                            productionBatchId: completedNote.productionBatchId,
                            processType: { code: 'CONTEO' }
                        }
                    });

                    if (conteoExists === 0) {
                        // No CONTEO → EMPAQUE is the source of truth for actual production
                        const empParams = completedNote.processParameters || {};
                        const actualApproved = empParams.empaque?.approved_qty
                            || empParams.empaqueRef?.conteo_qty
                            || parseFloat(actualQuantity) || 0;

                        if (actualApproved > 0) {
                            // Find sibling ENSAMBLE notes for the same product
                            const ensambleSiblings = await prisma.assemblyNote.findMany({
                                where: {
                                    productionBatchId: completedNote.productionBatchId,
                                    processType: { code: 'ENSAMBLE' },
                                    productId: (await prisma.assemblyNote.findUnique({ where: { id }, select: { productId: true } }))?.productId,
                                    status: { in: ['PENDING', 'IN_PROGRESS'] }
                                },
                                include: { items: true }
                            });

                            for (const ensamble of ensambleSiblings) {
                                const oldTarget = ensamble.targetQuantity || 0;
                                if (oldTarget <= 0) continue;

                                const scaleFactor = actualApproved / oldTarget;
                                if (Math.abs(scaleFactor - 1) < 0.001) continue; // No change needed

                                // Scale targetQuantity
                                await prisma.assemblyNote.update({
                                    where: { id: ensamble.id },
                                    data: { targetQuantity: actualApproved }
                                });

                                // Scale all items proportionally
                                for (const item of ensamble.items) {
                                    const pq = item.plannedQuantity;
                                    if (pq == null || pq <= 0) continue;
                                    const newQty = pq * scaleFactor;
                                    // For items measured in units (tarros, tapas, etc.), round to integer
                                    // For grams, keep as-is
                                    const finalQty = item.unit === 'gramo' ? Math.round(newQty) : Math.round(newQty);
                                    await prisma.assemblyNoteItem.update({
                                        where: { id: item.id },
                                        data: { plannedQuantity: finalQty, actualQuantity: finalQty }
                                    });
                                }

                                console.log(`[completeNote] EMPAQUE → ENSAMBLE scaled ${ensamble.stageName}: target ${oldTarget} → ${actualApproved} (×${scaleFactor.toFixed(3)}) [NO CONTEO — SIROPE flow]`);
                            }
                        }
                    }
                }
            } catch (postCompletionErr) {
                console.warn('[completeNote] Post-completion scaling failed (non-critical):', postCompletionErr.message);
            }

            res.json({ ...result, consumptionAlerts: result.consumptionAlerts || undefined });
        } catch (error) {
            console.error(`[completeNote] ERROR for note ${req.params.id}:`, error.message, '\nBody:', JSON.stringify(req.body).slice(0, 500), '\nStack:', error.stack?.split('\n').slice(0, 5).join('\n'));
            res.status(400).json({ error: error.message });
        }
    },

    /**
     * GET /api/assembly-notes/:id/check-proteccion
     * Check if sufficient PROTECCIÓN stock exists for the batch's flavor
     */
    checkProteccion: async (req, res) => {
        try {
            const { id } = req.params;
            const note = await prisma.assemblyNote.findUnique({
                where: { id },
                include: { productionBatch: true }
            });
            if (!note) return res.status(404).json({ error: 'Nota no encontrada' });

            // Resolve flavor from batch
            const flavor = note.productionBatch?.flavor || '';
            if (!flavor) return res.json({ available: 0, sufficient: false, flavor: 'DESCONOCIDO', message: 'No se pudo determinar el sabor del batch' });

            // Find the PROTECCION product for this flavor (accent-insensitive)
            const flavorNorm = stripAccents(flavor).toUpperCase();
            const allProtProducts = await prisma.product.findMany({
                where: { name: { startsWith: 'PROTECCION', mode: 'insensitive' } },
                select: { id: true, name: true, currentStock: true }
            });
            const proteccionProduct = allProtProducts.find(p =>
                stripAccents(p.name).toUpperCase() === `PROTECCION ${flavorNorm}`
            );

            if (!proteccionProduct) {
                return res.json({ available: 0, sufficient: false, flavor, message: `No existe producto PROTECCION ${flavor}` });
            }

            // Sum available MaterialLot stock
            const lots = await prisma.materialLot.findMany({
                where: { productId: proteccionProduct.id, status: 'AVAILABLE', currentQuantity: { gt: 0 } },
                select: { lotNumber: true, currentQuantity: true }
            });
            const available = lots.reduce((sum, l) => sum + l.currentQuantity, 0);

            // Flavor-specific threshold: MANGO BICHE CON SAL only produces 24,001g per formula
            const threshold = flavorNorm === 'MANGO BICHE CON SAL' ? 20000 : 50000;

            res.json({
                available,
                sufficient: available > threshold,
                flavor,
                productName: proteccionProduct.name,
                lots: lots.map(l => ({ lotNumber: l.lotNumber, quantity: l.currentQuantity }))
            });
        } catch (error) {
            console.error('checkProteccion error:', error.message);
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * POST /api/assembly-notes/quick-start
     * Start a process directly from a template — no production batch needed.
     * Creates a lightweight batch + assembly notes and returns the first note ID.
     */
    quickStart: async (req, res) => {
        try {
            const { templateId, userId, quantity, flavorKey, outputTargets: reqOutputTargets } = req.body;

            if (!templateId) {
                return res.status(400).json({ error: 'templateId is required' });
            }

            // 1. Load the template with stages and inputs (including sub-templates)
            const template = await prisma.assemblyTemplate.findUnique({
                where: { id: templateId },
                include: {
                    product: true,
                    stages: {
                        include: {
                            processType: true,
                            inputs: { include: { product: true }, orderBy: { displayOrder: 'asc' } },
                            subTemplate: {
                                include: {
                                    product: true,
                                    stages: {
                                        include: {
                                            processType: true,
                                            inputs: { include: { product: true }, orderBy: { displayOrder: 'asc' } }
                                        },
                                        orderBy: { stageOrder: 'asc' }
                                    }
                                }
                            }
                        },
                        orderBy: { stageOrder: 'asc' }
                    }
                }
            });

            if (!template) {
                return res.status(404).json({ error: 'Template not found' });
            }

            // 1b. Flatten stages: expand sub-templates into their child stages
            const flatStages = [];
            for (const stage of template.stages) {
                if (stage.subTemplateId && stage.subTemplate?.stages?.length > 0) {
                    console.log(`[quickStart] Expanding sub-template ${stage.subTemplate.templateCode} (${stage.subTemplate.stages.length} stages) for stage ${stage.stageOrder} "${stage.stageName}"`);
                    // Replace this stage with all stages from the sub-template
                    for (const subStage of stage.subTemplate.stages) {
                        flatStages.push({
                            ...subStage,
                            _fromSubTemplate: stage.subTemplate.templateCode,
                            _subTemplateProductId: stage.subTemplate.productId
                        });
                    }
                } else {
                    if (stage.subTemplateId) {
                        console.log(`[quickStart] WARNING: Stage ${stage.stageOrder} has subTemplateId=${stage.subTemplateId} but subTemplate data is missing!`);
                    }
                    flatStages.push(stage);
                }
            }
            console.log(`[quickStart] Template "${template.templateCode}" — original stages: ${template.stages.length}, flat stages: ${flatStages.length}`);

            // 2. Generate batch number: PRODUCTNAME-AAMMDD-HHMM (Colombia TZ)
            const now = new Date();
            const co = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
            const yy = String(co.getFullYear()).slice(-2);
            const MM = String(co.getMonth() + 1).padStart(2, '0');
            const dd = String(co.getDate()).padStart(2, '0');
            const hh = String(co.getHours()).padStart(2, '0');
            const mm = String(co.getMinutes()).padStart(2, '0');

            // ── Flavor resolution for generic templates ──
            const isGeniality = template.templateCode === 'BATCH-GENIALITY' || template.templateCode === 'BATCH-ESCARCHADOR' || template.templateCode === 'BATCH-LIQUIMON';
            const isEscarchadorBatch = template.templateCode === 'BATCH-ESCARCHADOR';
            const isLiquimonBatch = template.templateCode === 'BATCH-LIQUIMON';
            let flavorProductId = null; // resolved output product (ESFERAS [SABOR])
            let flavorCompuestoId = null; // resolved input product (COMPUESTO [SABOR])
            let sizeMap = {}; // resolved output products per size (3400, 1150, 350)
            if (flavorKey && isGeniality && !isEscarchadorBatch && !isLiquimonBatch) {
                // ── GENIALITY flavor resolution: just replace {SABOR} in stage names ──
                const flavorNorm = stripAccents(flavorKey).toUpperCase();
                console.log(`[quickStart] Geniality flavor resolution: ${flavorKey}`);

                for (const stage of flatStages) {
                    if (stage.stageName) {
                        stage.stageName = stage.stageName
                            .replace(/\{SABOR\}/g, flavorKey.toUpperCase())
                            .replace(/MARACUYA/gi, flavorKey.toUpperCase());
                    }
                }

                // ── Swap BASE sub-template when product is ESCARCHADOR ──
                // BATCH-GENIALITY defaults to TMPL064 (BASE SIROPE CLASICA).
                // When flavorKey is ESCARCHADOR, replace base stages with BASE ESCARCHADOR (GTPL-ESCARCHADO-v1).
                const defaultBaseCode = 'TMPL064'; // BASE SIROPE CLASICA default
                const hasDefaultBase = flatStages.some(s => s._fromSubTemplate === defaultBaseCode);
                if (hasDefaultBase && flavorNorm === 'ESCARCHADOR') {
                    const escarchadoBaseTemplate = await prisma.assemblyTemplate.findFirst({
                        where: { templateCode: 'GTPL-ESCARCHADO-v1', isActive: true },
                        include: {
                            product: true,
                            stages: {
                                include: {
                                    processType: true,
                                    inputs: { include: { product: true }, orderBy: { displayOrder: 'asc' } }
                                },
                                orderBy: { stageOrder: 'asc' }
                            }
                        }
                    });

                    if (escarchadoBaseTemplate?.stages?.length > 0) {
                        console.log(`[quickStart] Geniality BASE swap: ${defaultBaseCode} → GTPL-ESCARCHADO-v1 (${escarchadoBaseTemplate.product?.name})`);
                        const startIdx = flatStages.findIndex(s => s._fromSubTemplate === defaultBaseCode);
                        if (startIdx >= 0) {
                            const endIdx = flatStages.findLastIndex(s => s._fromSubTemplate === defaultBaseCode);
                            const count = endIdx - startIdx + 1;
                            const newSubStages = escarchadoBaseTemplate.stages.map(subStage => ({
                                ...subStage,
                                _fromSubTemplate: escarchadoBaseTemplate.templateCode,
                                _subTemplateProductId: escarchadoBaseTemplate.productId
                            }));
                            flatStages.splice(startIdx, count, ...newSubStages);
                            console.log(`[quickStart] Replaced ${count} BASE CLASICA stages with ${newSubStages.length} from GTPL-ESCARCHADO-v1`);
                        }
                    } else {
                        console.warn(`[quickStart] ⚠️ No se encontró GTPL-ESCARCHADO-v1 — usando BASE SIROPE CLASICA por defecto`);
                    }
                }

                // ── Swap SABORIZACION sub-template to the correct flavor ──
                // BATCH-GENIALITY defaults to TMPL065 (MARACUYA). Each flavor has its own
                // SABORIZACION sub-template with different colors and sabores.
                // ESCARCHADOR no tiene SABORIZACION separada — se omite el swap.
                const defaultSaborCode = 'TMPL065'; // MARACUYA default
                const hasDefaultSabor = flatStages.some(s => s._fromSubTemplate === defaultSaborCode);
                if (hasDefaultSabor && flavorNorm !== 'MARACUYA' && flavorNorm !== 'ESCARCHADOR') {
                    // Find the correct SABORIZACION sub-template by matching product name
                    const correctSaborTemplate = await prisma.assemblyTemplate.findFirst({
                        where: {
                            product: { name: { contains: `SABORIZACION ${flavorKey}`, mode: 'insensitive' } }
                        },
                        include: {
                            product: true,
                            stages: {
                                include: {
                                    processType: true,
                                    inputs: { include: { product: true }, orderBy: { displayOrder: 'asc' } }
                                },
                                orderBy: { stageOrder: 'asc' }
                            }
                        }
                    });

                    if (correctSaborTemplate?.stages?.length > 0) {
                        console.log(`[quickStart] Geniality SABORIZACION swap: ${defaultSaborCode} → ${correctSaborTemplate.templateCode} (${correctSaborTemplate.product?.name})`);
                        const startIdx = flatStages.findIndex(s => s._fromSubTemplate === defaultSaborCode);
                        if (startIdx >= 0) {
                            const endIdx = flatStages.findLastIndex(s => s._fromSubTemplate === defaultSaborCode);
                            const count = endIdx - startIdx + 1;
                            const newSubStages = correctSaborTemplate.stages.map(subStage => ({
                                ...subStage,
                                stageName: subStage.stageName?.replace(/MARACUYA/gi, flavorKey.toUpperCase()),
                                _fromSubTemplate: correctSaborTemplate.templateCode,
                                _subTemplateProductId: correctSaborTemplate.productId
                            }));
                            flatStages.splice(startIdx, count, ...newSubStages);
                            console.log(`[quickStart] Replaced ${count} SABORIZACION stages with ${newSubStages.length} from ${correctSaborTemplate.templateCode}`);
                        }
                    } else {
                        console.warn(`[quickStart] ⚠️ No SABORIZACION sub-template found for flavor "${flavorKey}" — keeping MARACUYA defaults`);
                    }
                } else if (hasDefaultSabor && flavorNorm === 'ESCARCHADOR') {
                    // ESCARCHADOR: eliminar etapas de SABORIZACION (no aplica)
                    const startIdx = flatStages.findIndex(s => s._fromSubTemplate === defaultSaborCode);
                    if (startIdx >= 0) {
                        const endIdx = flatStages.findLastIndex(s => s._fromSubTemplate === defaultSaborCode);
                        flatStages.splice(startIdx, endIdx - startIdx + 1);
                        console.log(`[quickStart] ESCARCHADOR — removed ${endIdx - startIdx + 1} SABORIZACION stages (not applicable)`);
                    }
                }

                // ── Swap LLENADO (EMPAQUE) sub-templates to the correct flavor ──
                // TMPL066 (1000ml) and TMPL067 (360ml) are MARACUYA defaults.
                // Each flavor has its own LLENADO sub-templates with different items.
                const defaultLlenadoCodes = ['TMPL066', 'TMPL067'];
                for (const defCode of defaultLlenadoCodes) {
                    const hasDefault = flatStages.some(s => s._fromSubTemplate === defCode);
                    if (!hasDefault || flavorNorm === 'MARACUYA') continue;

                    // Find corresponding flavor sub-template by size
                    const sizeMatch = defCode === 'TMPL066' ? '1000' : '360';
                    const correctLlenado = await prisma.assemblyTemplate.findFirst({
                        where: {
                            product: {
                                name: { contains: `SIROPE GENIALITY`, mode: 'insensitive' },
                                AND: [
                                    { name: { contains: flavorKey, mode: 'insensitive' } },
                                    { name: { contains: sizeMatch, mode: 'insensitive' } }
                                ]
                            }
                        },
                        include: {
                            product: true,
                            stages: {
                                include: {
                                    processType: true,
                                    inputs: { include: { product: true }, orderBy: { displayOrder: 'asc' } }
                                },
                                orderBy: { stageOrder: 'asc' }
                            }
                        }
                    });

                    if (correctLlenado?.stages?.length > 0) {
                        console.log(`[quickStart] Geniality LLENADO swap: ${defCode} → ${correctLlenado.templateCode} (${correctLlenado.product?.name})`);
                        const startIdx = flatStages.findIndex(s => s._fromSubTemplate === defCode);
                        if (startIdx >= 0) {
                            const endIdx = flatStages.findLastIndex(s => s._fromSubTemplate === defCode);
                            const count = endIdx - startIdx + 1;
                            const newSubStages = correctLlenado.stages.map(subStage => ({
                                ...subStage,
                                stageName: subStage.stageName?.replace(/MARACUYA/gi, flavorKey.toUpperCase()),
                                _fromSubTemplate: correctLlenado.templateCode,
                                _subTemplateProductId: correctLlenado.productId
                            }));
                            flatStages.splice(startIdx, count, ...newSubStages);
                            console.log(`[quickStart] Replaced ${count} LLENADO stages with ${newSubStages.length} from ${correctLlenado.templateCode}`);
                        }
                    }
                }

                // Resolve SIROPE GENIALITY output products per size for output targets
                const allSirope = await prisma.product.findMany({
                    where: {
                        name: { contains: 'SIROPE GENIALITY', mode: 'insensitive' },
                    },
                    select: { id: true, name: true }
                });
                for (const size of ['1000', '360']) {
                    const target = stripAccents(`SIROPE GENIALITY SABOR A ${flavorKey} X ${size}`).toUpperCase();
                    const prod = allSirope.find(p =>
                        stripAccents(p.name).toUpperCase().includes(target)
                    );
                    if (prod) {
                        sizeMap[size] = prod;
                        console.log(`[quickStart] Geniality size ${size}ml → ${prod.name} (${prod.id})`);
                    }
                }

                // ── Resolve outputProductId for Geniality EMPAQUE/ENSAMBLE sub-template stages ──
                // Sub-templates (TMPL066=1000ml, TMPL067=360ml) have default MARACUYA outputProductId.
                // Replace with the correct flavor product from sizeMap so EMPAQUE target resolution works.
                for (const stage of flatStages) {
                    const code = stage.processType?.code;
                    if (code !== 'EMPAQUE' && code !== 'ENSAMBLE') continue;
                    const name = (stage.stageName || '').toUpperCase();
                    for (const [size, prod] of Object.entries(sizeMap)) {
                        if (name.includes(size)) {
                            stage.outputProductId = prod.id;
                            console.log(`[quickStart] Geniality ${code} "${stage.stageName}" → outputProductId=${prod.id} (${prod.name})`);
                            break;
                        }
                    }
                    // Also check if this size has 0 planned units → skip
                    if (stage.outputProductId) {
                        const schedulerTarget = (reqOutputTargets || []).find(t => t.productId === stage.outputProductId);
                        if (schedulerTarget && schedulerTarget.plannedUnits === 0) {
                            stage._skipStage = true;
                            console.log(`[quickStart] Geniality ${code} "${stage.stageName}" → skipped (0 planned units)`);
                        }
                    }
                }

                console.log(`[quickStart] After Geniality substitution, ${flatStages.length} flat stages`);
            } else if (isEscarchadorBatch) {
                // BATCH-ESCARCHADOR: sub-templates are already correct (TMPL101 = BASE ESCARCHADOR).
                // Only resolve SIROPE GENIALITY ESCARCHADOR output products per size for EMPAQUE/ENSAMBLE stages.
                console.log(`[quickStart] BATCH-ESCARCHADOR — skipping flavor resolution, resolving output products`);
                const allSirope = await prisma.product.findMany({
                    where: { name: { contains: 'SIROPE GENIALITY ESCARCHADOR', mode: 'insensitive' } },
                    select: { id: true, name: true }
                });
                for (const size of ['1000', '360']) {
                    const target = `ESCARCHADOR X ${size}`;
                    const prod = allSirope.find(p => p.name.toUpperCase().includes(target));
                    if (prod) {
                        sizeMap[size] = prod;
                        console.log(`[quickStart] Escarchador size ${size}ml → ${prod.name} (${prod.id})`);
                    }
                }
                // Assign outputProductId to EMPAQUE/ENSAMBLE stages
                for (const stage of flatStages) {
                    const code = stage.processType?.code;
                    if (code !== 'EMPAQUE' && code !== 'ENSAMBLE' && code !== 'G_EMPAQUE' && code !== 'G_ENSAMBLE') continue;
                    const name = (stage.stageName || '').toUpperCase();
                    for (const [size, prod] of Object.entries(sizeMap)) {
                        if (name.includes(size)) {
                            stage.outputProductId = prod.id;
                            console.log(`[quickStart] Escarchador ${code} "${stage.stageName}" → outputProductId=${prod.id} (${prod.name})`);
                            break;
                        }
                    }
                    // Skip if 0 planned units
                    if (stage.outputProductId) {
                        const schedulerTarget = (reqOutputTargets || []).find(t => t.productId === stage.outputProductId);
                        if (schedulerTarget && schedulerTarget.plannedUnits === 0) {
                            stage._skipStage = true;
                            console.log(`[quickStart] Escarchador ${code} "${stage.stageName}" → skipped (0 planned units)`);
                        }
                    }
                }
                console.log(`[quickStart] BATCH-ESCARCHADOR: ${flatStages.length} flat stages ready`);
            } else if (isLiquimonBatch) {
                // BATCH-LIQUIMON: sub-templates already correct (TMPL-LIQ-BASE = Base Cítrica).
                // Resolve LIQUIMON output products per size for EMPAQUE/ENSAMBLE stages.
                console.log(`[quickStart] BATCH-LIQUIMON — resolving output products`);
                const allLiquimon = await prisma.product.findMany({
                    where: { name: { contains: 'LIQUIMON', mode: 'insensitive' }, accountGroup: 1402 },
                    select: { id: true, name: true }
                });
                for (const size of ['1000', '500']) {
                    const prod = allLiquimon.find(p => p.name.toUpperCase().includes(`${size} ML`));
                    if (prod) {
                        sizeMap[size] = prod;
                        console.log(`[quickStart] Liquimon size ${size}ml → ${prod.name} (${prod.id})`);
                    }
                }
                for (const stage of flatStages) {
                    const code = stage.processType?.code;
                    if (code !== 'G_EMPAQUE' && code !== 'G_ENSAMBLE') continue;
                    const name = (stage.stageName || '').toUpperCase();
                    for (const [size, prod] of Object.entries(sizeMap)) {
                        if (name.includes(size)) {
                            stage.outputProductId = prod.id;
                            console.log(`[quickStart] Liquimon ${code} "${stage.stageName}" → outputProductId=${prod.id} (${prod.name})`);
                            break;
                        }
                    }
                    if (stage.outputProductId) {
                        const schedulerTarget = (reqOutputTargets || []).find(t => t.productId === stage.outputProductId);
                        if (schedulerTarget && schedulerTarget.plannedUnits === 0) {
                            stage._skipStage = true;
                            console.log(`[quickStart] Liquimon ${code} "${stage.stageName}" → skipped (0 planned units)`);
                        }
                    }
                }
                console.log(`[quickStart] BATCH-LIQUIMON: ${flatStages.length} flat stages ready`);
            } else if (flavorKey) {
                // Use accent-insensitive JS matching (CAFE matches CAFÉ)
                const flavorNorm = stripAccents(flavorKey).toUpperCase();
                const allEsferas = await prisma.product.findMany({
                    where: { name: { startsWith: 'ESFERAS', mode: 'insensitive' } },
                    select: { id: true, name: true }
                });
                // Try exact match first, then startsWith, then contains
                let esferaProduct = allEsferas.find(p =>
                    stripAccents(p.name).toUpperCase() === `ESFERAS ${flavorNorm}`
                );
                if (!esferaProduct) {
                    esferaProduct = allEsferas.find(p =>
                        stripAccents(p.name).toUpperCase().startsWith(`ESFERAS ${flavorNorm}`)
                    );
                }
                const allCompuestos = await prisma.product.findMany({
                    where: { name: { startsWith: 'COMPUESTO', mode: 'insensitive' } },
                    select: { id: true, name: true }
                });
                let compuestoProduct = allCompuestos.find(p =>
                    stripAccents(p.name).toUpperCase() === `COMPUESTO ${flavorNorm}`
                );
                if (!compuestoProduct) {
                    compuestoProduct = allCompuestos.find(p =>
                        stripAccents(p.name).toUpperCase().startsWith(`COMPUESTO ${flavorNorm}`)
                    );
                }
                if (!esferaProduct || !compuestoProduct) {
                    return res.status(400).json({
                        error: `Sabor "${flavorKey}" no tiene productos ESFERAS/COMPUESTO definidos`
                    });
                }
                flavorProductId = esferaProduct.id;
                flavorCompuestoId = compuestoProduct.id;
                console.log(`[quickStart] Flavor resolved: ${flavorKey} → ESFERAS=${esferaProduct.name}, COMPUESTO=${compuestoProduct.name}`);

                // ── Resolve finished products per size for Empaque/Ensamble stages ──
                sizeMap = {};
                const allLiqui = await prisma.product.findMany({
                    where: {
                        name: { contains: 'LIQUIPOPS SABOR', mode: 'insensitive' },
                        NOT: { name: { contains: 'ETIQUETA' } }
                    },
                    select: { id: true, name: true }
                });
                for (const size of ['3400', '1150', '350']) {
                    const target = stripAccents(`LIQUIPOPS SABOR A ${flavorKey} X ${size}`).toUpperCase();
                    const prod = allLiqui.find(p =>
                        stripAccents(p.name).toUpperCase().includes(target)
                    );
                    if (prod) {
                        sizeMap[size] = prod;
                        console.log(`[quickStart] Size ${size}g → ${prod.name} (${prod.id})`);
                    } else {
                        console.log(`[quickStart] WARNING: No product found for LIQUIPOPS SABOR A ${flavorKey} X ${size}`);
                    }
                }

                // ── Resolve Compuesto sub-template (if it exists for this flavor) ──
                const compuestoTemplate = await prisma.assemblyTemplate.findFirst({
                    where: {
                        productId: compuestoProduct.id,
                        isActive: true
                    },
                    select: { id: true, templateCode: true }
                });
                if (compuestoTemplate) {
                    console.log(`[quickStart] Found compuesto sub-template: ${compuestoTemplate.templateCode}`);
                }

                // ── Apply flavor substitution to all flat stages ──
                for (const stage of flatStages) {
                    const params = stage.processParameters || {};

                    // Replace {SABOR} placeholder and FRESA references in stage names
                    if (stage.stageName) {
                        stage.stageName = stage.stageName
                            .replace(/\{SABOR\}/g, flavorKey.toUpperCase())
                            .replace(/ESFERAS\s+\w+[\w\s]*/i, `ESFERAS ${flavorKey}`)
                            .replace(/FRESA/gi, flavorKey.toUpperCase());
                    }

                    // ── Handle flavor-dependent stages from BATCH template ──
                    if (params.flavorDependent) {
                        const role = params.flavorRole;

                        // Helper: check if this size has planned units from scheduler
                        const sizeHasUnits = (sizeKey) => {
                            const prod = sizeMap[sizeKey];
                            if (!prod) return false;
                            const target = (reqOutputTargets || []).find(t => t.productId === prod.id);
                            return (target?.plannedUnits || 0) > 0;
                        };

                        // Resolve output product based on role
                        if (role === 'esferificacion') {
                            stage.outputProductId = flavorProductId;
                        } else if (role === 'empaque_3400' || role === 'ensamble_3400') {
                            const prod = sizeMap['3400'];
                            if (prod) {
                                stage.outputProductId = prod.id;
                                if (stage.processParameters) stage.processParameters.product_id = prod.id;
                            }
                            if (!sizeHasUnits('3400')) stage._skipStage = true;
                        } else if (role === 'empaque_1150' || role === 'ensamble_1150') {
                            const prod = sizeMap['1150'];
                            if (prod) {
                                stage.outputProductId = prod.id;
                                if (stage.processParameters) stage.processParameters.product_id = prod.id;
                            }
                            if (!sizeHasUnits('1150')) stage._skipStage = true;
                        } else if (role === 'empaque_350' || role === 'ensamble_350') {
                            const prod = sizeMap['350'];
                            if (prod) {
                                stage.outputProductId = prod.id;
                                if (stage.processParameters) stage.processParameters.product_id = prod.id;
                            }
                            if (!sizeHasUnits('350')) stage._skipStage = true;
                        }
                    }

                    // Substitute COMPUESTO inputs in any stage
                    if (stage.inputs) {
                        stage.inputs = stage.inputs.map(input => {
                            if (input.product?.name?.startsWith('COMPUESTO')) {
                                console.log(`[quickStart] Substituting input: ${input.product.name} → ${compuestoProduct.name}`);
                                return {
                                    ...input,
                                    productId: flavorCompuestoId,
                                    product: compuestoProduct,
                                };
                            }
                            return input;
                        });
                    }

                    // ── Substitute EMPAQUE/ENSAMBLE inputs from the correct flavor's formula ──
                    if (params.flavorDependent && stage.outputProductId) {
                        const stageRole = params.flavorRole || '';
                        if (stageRole.startsWith('empaque_') || stageRole.startsWith('ensamble_')) {
                            const flavorFormula = await prisma.formula.findFirst({
                                where: { productId: stage.outputProductId, isActive: true },
                                include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true } } } } },
                                orderBy: { version: 'desc' }
                            });
                            if (flavorFormula && flavorFormula.items.length > 0) {
                                stage.inputs = flavorFormula.items.map(fi => ({
                                    productId: fi.ingredientId,
                                    product: fi.ingredient,
                                    inputType: fi.ingredientType || 'RAW_MATERIAL',
                                    quantityPerUnit: fi.quantity,
                                    unit: fi.unit || 'gramo',
                                    aggregateOnRepeat: false
                                }));
                                console.log(`[quickStart] Replaced ${stageRole} inputs from formula ${flavorFormula.formulaCode}: ${stage.inputs.length} items`);
                            } else {
                                console.log(`[quickStart] WARNING: No formula found for ${stageRole} product ${stage.outputProductId}`);
                            }
                        }
                    }
                }

                // ── Resolve Compuesto sub-template in template.stages (pre-flattening) ──
                if (compuestoTemplate) {
                    const correctSubTemplate = await prisma.assemblyTemplate.findUnique({
                        where: { id: compuestoTemplate.id },
                        include: {
                            product: true,
                            stages: {
                                include: {
                                    processType: true,
                                    inputs: { include: { product: true }, orderBy: { displayOrder: 'asc' } }
                                },
                                orderBy: { stageOrder: 'asc' }
                            }
                        }
                    });

                    if (correctSubTemplate?.stages?.length > 0) {
                        const defaultCompuestoCode = 'TMPL008'; // Default FRESA compuesto
                        const startIdx = flatStages.findIndex(s => s._fromSubTemplate === defaultCompuestoCode);
                        if (startIdx >= 0) {
                            const endIdx = flatStages.findLastIndex(s => s._fromSubTemplate === defaultCompuestoCode);
                            const count = endIdx - startIdx + 1;
                            const newSubStages = correctSubTemplate.stages.map(subStage => ({
                                ...subStage,
                                _fromSubTemplate: correctSubTemplate.templateCode,
                                _subTemplateProductId: correctSubTemplate.productId
                            }));
                            flatStages.splice(startIdx, count, ...newSubStages);
                            console.log(`[quickStart] Replaced ${count} FRESA compuesto stages with ${newSubStages.length} ${flavorKey} stages`);
                        }
                    }
                }

                console.log(`[quickStart] After substitution, ${flatStages.length} flat stages`);
            }

            // Use flavor product or template product for batch
            const isBatchTemplate = template.templateCode?.startsWith('BATCH');
            const batchProductId = isBatchTemplate ? template.productId : (flavorProductId || template.productId);
            const batchProductName = isBatchTemplate
                ? (flavorKey ? flavorKey.toUpperCase() : template.product?.name)
                : (flavorKey ? `ESFERAS ${flavorKey}` : (template.product?.name || template.templateCode));

            // Use product name abbreviation for readable batch numbers (e.g. GOMAS, CALCIO, ALGINATO)
            const productLabel = batchProductName
                .replace(/^PREMEZCLA\s*/i, '')
                .replace(/\s+PARA\s+PERLAS$/i, '')
                .replace(/\s+PERLAS$/i, '')
                .replace(/\s+/g, '-')
                .toUpperCase()
                .slice(0, 20);
            const batchNumber = `${productLabel}-${yy}${MM}${dd}-${hh}${mm}`;

            // 3. Create or reuse production batch
            const { existingBatchId } = req.body;
            let batch;

            if (existingBatchId) {
                // Validate sequential start: block if ANY prior production batch on the same line hasn't been started
                const thisBatch = await prisma.productionBatch.findUnique({
                    where: { id: existingBatchId },
                    select: { flavor: true, scheduledStart: true, outputTargets: { select: { product: { select: { group: { select: { name: true } } } } } } }
                });
                if (thisBatch?.scheduledStart) {
                    const AUX_FLAVORS = ['LAVADO', 'PAUSA ACTIVA', 'MANTENIMIENTO', 'REUNIÓN', 'REUNION', 'CAMBIO DE AGUA'];
                    const lineGroup = 'GENIALITY';
                    const priorPending = await prisma.productionBatch.findFirst({
                        where: {
                            id: { not: existingBatchId },
                            status: 'PENDING',
                            startedAt: null,
                            flavor: { notIn: AUX_FLAVORS },
                            scheduledStart: { lt: thisBatch.scheduledStart },
                            outputTargets: { some: { product: { group: { name: lineGroup } } } },
                        },
                        orderBy: { scheduledStart: 'asc' },
                        select: { batchNumber: true, flavor: true, scheduledStart: true }
                    });
                    if (priorPending) {
                        return res.status(400).json({
                            error: `Debes iniciar el bache anterior primero (${priorPending.flavor || priorPending.batchNumber}). No puedes saltar baches en la secuencia.`
                        });
                    }
                }

                // Reuse the existing batch (from scheduler) — regenerate batchNumber with actual start date
                batch = await prisma.productionBatch.update({
                    where: { id: existingBatchId },
                    data: {
                        batchNumber,  // ← regenerated with current date/time (production start)
                        status: 'STAGE_1_BASE',
                        startedAt: now,
                        currentStage: 1,
                    }
                });
                console.log(`[quickStart] Reusing existing batch → new batchNumber=${batchNumber} (was ${batch.batchNumber}, id=${existingBatchId})`);

                const { rescheduleAfterBatchStart } = require('./productionSchedulerController');
                rescheduleAfterBatchStart(existingBatchId, 'geniality').catch(err =>
                    console.error('[quickStart] geniality reschedule error:', err.message)
                );
            } else {
                try {
                    batch = await prisma.productionBatch.create({
                        data: {
                            batchNumber,
                            productId: batchProductId,
                            flavor: flavorKey || null,
                            status: 'STAGE_1_BASE',
                            scheduledStart: now,
                            notes: `Proceso rápido desde plantilla ${template.templateCode}`,
                            currentStage: 1,
                            startedAt: now
                        }
                    });
                } catch (e) {
                    if (e.code === 'P2002') {
                        return res.status(409).json({ error: `Ya existe un bache "${batchNumber}". Solo se puede crear un bache por minuto. Espera 1 minuto e intenta de nuevo.` });
                    }
                    throw e;
                }
            }

            // 3b. Create BatchOutputTarget records for BATCH-LIQUIPOPS (sizes: 3400, 1150, 350)
            // Skip if reusing existing batch — targets were already created by the scheduler
            if (!existingBatchId && Object.keys(sizeMap).length > 0) {
                for (const [size, prod] of Object.entries(sizeMap)) {
                    // Use planned units from scheduler if available
                    const schedulerTarget = (reqOutputTargets || []).find(t => t.productId === prod.id);
                    const plannedUnits = schedulerTarget?.plannedUnits || 0;
                    const plannedWeightKg = schedulerTarget?.plannedWeightKg || 0;
                    await prisma.batchOutputTarget.create({
                        data: {
                            batchId: batch.id,
                            productId: prod.id,
                            plannedUnits,
                            plannedWeightKg,
                        }
                    });
                    console.log(`[quickStart] Created outputTarget: ${prod.name} — ${plannedUnits} units`);
                }
            }

            // 4. Create assembly notes from flattened stages
            // Only PESAJE stages repeat N times (one per batch).
            // Non-PESAJE stages (ENSAMBLE, etc.) get a single note with quantity = total.
            const notes = [];
            let baseQty = 1;

            // Log if we ignored a multi-lot request from the frontend
            if (quantity > 1) {
                console.log(`[quickStart] ⚠️ Ignored frontend quantity=${quantity} for Geniality, forcing 1 massive bundle.`);
            }

            const isGenialityTemplate = template.templateCode === 'BATCH-GENIALITY' || template.templateCode === 'BATCH-ESCARCHADOR' || template.templateCode === 'BATCH-LIQUIMON';
            const scaleFactor = (isGenialityTemplate && batch.baseWeight && batch.baseWeight > 0)
                 ? (batch.baseWeight / 100.0) // Simply total kg divided by 100kg formula baseline
                 : 1.0;

            console.log(`[quickStart] ⚡ baseQty=${baseQty} (raw quantity=${quantity}, baseWeight=${batch.baseWeight}, scaleFactor=${scaleFactor}), flatStages=${flatStages.length}`);
            let globalStageOrder = 0;

            for (const stage of flatStages) {
                // Skip stages for sizes with 0 planned units (e.g. empaque_1150 when no 1150 was planned)
                if (stage._skipStage) {
                    console.log(`[quickStart] Skipping stage "${stage.stageName}" — zero planned units`);
                    continue;
                }
                const isPesaje = ['PESAJE', 'G_PESAJE'].includes(stage.processType?.code);
                const isGEProduction = ['GE_PREMIX', 'GE_BASE_LIQUIDA', 'GE_COCCION'].includes(stage.processType?.code);
                const isEnsamble = ['ENSAMBLE', 'G_ENSAMBLE'].includes(stage.processType?.code);

                // ── Resolve noteQty and noteUnit for this stage ──
                // PESAJE/GE_ inputs can be:
                //   a) Per-gram ratios (e.g. BASE=0.98/g) → need × formula.baseQuantity
                //   b) Absolute quantities (e.g. AGUA=48000g) → use as-is
                // Heuristic: if ALL quantityPerUnit < 2, they're ratios; otherwise absolute.
                // ENSAMBLE: template inputs store ABSOLUTE quantities (e.g. 118004g).
                let noteQty = (isPesaje || isGEProduction) ? 1 : baseQty;
                let noteUnit = 'lote';
                const stageProductId = stage.outputProductId || stage._subTemplateProductId;
                let pesajeBaseQuantity = null; // only set when inputs are per-gram ratios

                if ((isPesaje || isGEProduction) && stageProductId) {
                    const stageFormula = await prisma.formula.findFirst({
                        where: { productId: stageProductId, isActive: true },
                        select: { baseQuantity: true, baseUnit: true },
                        orderBy: { version: 'desc' }
                    });
                    if (stageFormula) {
                        noteUnit = stageFormula.baseUnit || 'gramo';
                        // Detect if inputs are per-gram ratios or absolute quantities
                        const maxInputQty = Math.max(...(stage.inputs || []).map(i => Math.abs(i.quantityPerUnit || 0)), 0);
                        if (maxInputQty > 0 && maxInputQty < 2) {
                            // Per-gram ratios → scale by formula.baseQuantity
                            pesajeBaseQuantity = stageFormula.baseQuantity;
                            noteQty = (stageFormula.baseQuantity || 1) * scaleFactor;
                            console.log(`[quickStart] PESAJE "${stage.stageName}" — inputs are per-gram ratios (max=${maxInputQty.toFixed(4)}), scaling by ${stageFormula.baseQuantity}`);
                        } else {
                            // Absolute quantities → use as-is
                            noteQty = (stageFormula.baseQuantity || 1) * scaleFactor;
                            console.log(`[quickStart] PESAJE "${stage.stageName}" — inputs are absolute (max=${maxInputQty}), noteQty=${noteQty} (scaleFactor: ${scaleFactor})`);
                        }
                    }
                }
                if (isEnsamble) {
                    const ensambleProductId = stage.outputProductId || stageProductId || template.productId;
                    const stageParams = stage.processParameters || {};

                    // Size-specific ENSAMBLE stages (ensamble_3400, ensamble_350):
                    // use planned units from scheduler, like EMPAQUE
                    const ensambleRole = stageParams.flavorRole || '';
                    if (ensambleRole.startsWith('ensamble_') && stage.outputProductId) {
                        const schedulerTarget = (reqOutputTargets || []).find(t => t.productId === stage.outputProductId);
                        const plannedUnits = schedulerTarget?.plannedUnits || 0;
                        if (plannedUnits > 0) {
                            noteQty = plannedUnits;
                            noteUnit = 'unidad';
                            console.log(`[quickStart] ENSAMBLE "${stage.stageName}" — ${plannedUnits} planned units`);
                        }
                    } else if (stage.outputProductId) {
                        // Geniality ENSAMBLE with outputProductId (from sub-template):
                        // use planned units from scheduler targets
                        const schedulerTarget = (reqOutputTargets || []).find(t => t.productId === stage.outputProductId);
                        const plannedUnits = schedulerTarget?.plannedUnits || 0;
                        if (plannedUnits > 0) {
                            noteQty = plannedUnits;
                            noteUnit = 'units';
                            console.log(`[quickStart] ENSAMBLE "${stage.stageName}" — ${plannedUnits} planned units (from scheduler)`);
                            // ── Resolve ENSAMBLE inputs from formula (per-unit) ──
                            // Only for finished-product ENSAMBLE (has scheduler target).
                            // Intermediate ENSAMBLE (BASE SIROPE, SABORIZACION) keep template ratios.
                            const ensambleFormula = await prisma.formula.findFirst({
                                where: { productId: stage.outputProductId, isActive: true },
                                include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true } } } } },
                                orderBy: { version: 'desc' }
                            });
                            if (ensambleFormula && ensambleFormula.items.length > 0) {
                                stage.inputs = ensambleFormula.items.map(fi => ({
                                    productId: fi.ingredientId,
                                    product: fi.ingredient,
                                    inputType: fi.ingredientType || 'RAW_MATERIAL',
                                    quantityPerUnit: fi.quantity,
                                    unit: fi.unit || fi.ingredient?.unit || 'gramo',
                                    _fromFormula: true
                                }));
                                console.log(`[quickStart] ENSAMBLE inputs resolved from formula ${ensambleFormula.formulaCode}: ${stage.inputs.length} items`);
                            }
                        } else {
                            // Fallback: formula baseQuantity × baseQty (intermediate stages like BASE SIROPE, SABORIZACION)
                            const formula = await prisma.formula.findFirst({
                                where: { productId: stage.outputProductId },
                                select: { baseQuantity: true, baseUnit: true },
                                orderBy: { version: 'desc' }
                            });
                            noteQty = (formula?.baseQuantity || 1) * baseQty * scaleFactor;
                            noteUnit = formula?.baseUnit || 'gramo';
                        }
                    } else {
                        // Generic ENSAMBLE (e.g. "Ensamble Siigo de BASE LIQUIPOPS"):
                        // use formula baseQuantity × baseQty
                        const formula = await prisma.formula.findFirst({
                            where: { productId: ensambleProductId },
                            select: { baseQuantity: true, baseUnit: true },
                            orderBy: { version: 'desc' }
                        });
                        noteQty = (formula?.baseQuantity || 1) * baseQty * scaleFactor;
                        noteUnit = formula?.baseUnit || 'gramo';
                    }
                }

                // ── EMPAQUE: resolve planned units from scheduler targets ──
                // EMPAQUE items are per-unit (1 tarro, 2500g esferas per jar).
                // Multiply by the planned jar count (e.g. 40 for 3400g, 100 for 350g).
                const isEmpaque = ['EMPAQUE', 'G_EMPAQUE'].includes(stage.processType?.code);
                if (isEmpaque && stage.outputProductId) {
                    const schedulerTarget = (reqOutputTargets || []).find(t => t.productId === stage.outputProductId);
                    const plannedUnits = schedulerTarget?.plannedUnits || 0;
                    if (plannedUnits > 0) {
                        noteQty = plannedUnits;
                        noteUnit = 'unidad';
                        console.log(`[quickStart] EMPAQUE "${stage.stageName}" — ${plannedUnits} planned units`);
                    }
                    // ── Resolve EMPAQUE inputs from formula (per-unit) instead of template (per-gram ratios) ──
                    // Template inputs may store per-gram ratios (e.g. 0.000738 TARRO/gram for Geniality siropes).
                    // The formula stores correct per-unit quantities (e.g. 1 TARRO per 1 unit of finished product).
                    const empaqueFormula = await prisma.formula.findFirst({
                        where: { productId: stage.outputProductId, isActive: true },
                        include: { items: { include: { ingredient: { select: { id: true, name: true, unit: true } } } } },
                        orderBy: { version: 'desc' }
                    });
                    if (empaqueFormula && empaqueFormula.items.length > 0) {
                        stage.inputs = empaqueFormula.items.map(fi => ({
                            productId: fi.ingredientId,
                            product: fi.ingredient,
                            inputType: fi.ingredientType || 'RAW_MATERIAL',
                            quantityPerUnit: fi.quantity,  // per-unit (e.g. 1 tarro per 1 unit)
                            unit: fi.unit || fi.ingredient?.unit || 'gramo',
                            _fromFormula: true
                        }));
                        console.log(`[quickStart] EMPAQUE inputs resolved from formula ${empaqueFormula.formulaCode}: ${stage.inputs.length} items (per-unit)`);
                    }
                }

                // ── FORMACION: resolve target quantity and inputs from formula ──
                const isFormacion = ['FORMACION', 'G_FORMACION'].includes(stage.processType?.code);
                let formulaInputs = null; // populated when template stage has no inputs
                if (isFormacion) {
                    const formacionProductId = stage.outputProductId || stageProductId || template.productId;
                    const formula = await prisma.formula.findFirst({
                        where: { productId: formacionProductId, isActive: true },
                        include: { items: { include: { ingredient: { select: { id: true, name: true } } } } },
                        orderBy: { version: 'desc' }
                    });
                    if (formula) {
                        noteQty = (formula.baseQuantity || 1) * baseQty * scaleFactor;
                        noteUnit = formula.baseUnit || 'gramo';
                        // If template stage has no inputs defined, use formula items
                        if (!stage.inputs || stage.inputs.length === 0) {
                            formulaInputs = formula.items.map(fi => ({
                                productId: fi.ingredientId,
                                inputType: 'SEMI_FINISHED',
                                quantityPerUnit: fi.quantity * baseQty * scaleFactor,
                                unit: fi.unit || 'gramo'
                            }));
                        }
                    }
                }

                // ── CONTEO: enrich with conteo map from sizeMap ──
                const isConteo = ['CONTEO', 'G_CONTEO'].includes(stage.processType?.code);
                let conteoParams = {};
                if (isConteo && Object.keys(sizeMap).length > 0) {
                    const conteoMap = {};
                    for (const [size, prod] of Object.entries(sizeMap)) {
                        const schedulerTarget = (reqOutputTargets || []).find(t => t.productId === prod.id);
                        conteoMap[prod.name] = {
                            planned: schedulerTarget?.plannedUnits || 0,
                            actual: 0,
                            productId: prod.id,
                            productName: prod.name,
                            esferas: 0,
                            esfera_factor: 0
                        };
                    }
                    conteoParams = { conteo: conteoMap };
                    // Total planned = sum of all planned units
                    const totalPlanned = Object.values(conteoMap).reduce((s, c) => s + c.planned, 0);
                    noteQty = totalPlanned;
                    noteUnit = 'unidad';
                }

                // ── PESAJE with aggregateOnRepeat support ─────────────────────
                // Split inputs: aggregate inputs go into ONE note (qty × N),
                // individual inputs go into N separate notes (qty × 1 each).
                if (isPesaje && baseQty > 1 && stage.inputs?.length > 0) {
                    console.log(`[quickStart] ⚡ PESAJE AGGREGATE BRANCH: baseQty=${baseQty}, inputs=${stage.inputs.length}, agg=${stage.inputs.filter(i => i.aggregateOnRepeat).length}, indiv=${stage.inputs.filter(i => !i.aggregateOnRepeat).length}`);
                    const aggregateInputs = stage.inputs.filter(i => i.aggregateOnRepeat);
                    const individualInputs = stage.inputs.filter(i => !i.aggregateOnRepeat);

                    // 1. Create ONE note for aggregated inputs (e.g. AGUA total)
                    if (aggregateInputs.length > 0) {
                        globalStageOrder++;
                        const aggNoteNumber = `${batchNumber}-S${globalStageOrder}-AGG`;
                        const aggItems = aggregateInputs.map(input => ({
                            componentId: input.productId,
                            componentType: input.inputType || 'RAW_MATERIAL',
                            plannedQuantity: pesajeBaseQuantity
                                ? input.quantityPerUnit * pesajeBaseQuantity * baseQty * scaleFactor
                                : input.quantityPerUnit * baseQty * scaleFactor,
                            unit: input.unit || 'gramo',
                            notes: null
                        }));
                        const aggTargetQuantity = aggItems.reduce((sum, item) => {
                            const unit = String(item.unit || '').toLowerCase();
                            return sum + (unit === 'kg' ? item.plannedQuantity * 1000 : item.plannedQuantity);
                        }, 0);

                        const aggNote = await prisma.assemblyNote.create({
                            data: {
                                noteNumber: aggNoteNumber,
                                productionBatchId: batch.id,
                                productId: stage.outputProductId || batchProductId,
                                templateId: template.id,
                                stageId: stage._fromSubTemplate ? null : stage.id,
                                stageOrder: globalStageOrder,
                                stageName: `${stage.stageName} — Total ${baseQty} lotes`,
                                targetQuantity: aggTargetQuantity,
                                unit: noteUnit,
                                status: 'PENDING',
                                processTypeId: stage.processTypeId,
                                processParameters: {
                                    ...(stage.processParameters || {}),
                                    aggregateNote: true,
                                    repeatTotal: baseQty,
                                    ...(stage._fromSubTemplate ? { fromSubTemplate: stage._fromSubTemplate } : {})
                                },
                                createdById: userId || null,
                                items: { create: aggItems }
                            },
                            include: {
                                items: { include: { component: true } },
                                processType: true,
                                product: true
                            }
                        });
                        notes.push(aggNote);
                    }

                    // 2. Create N notes for individual inputs (e.g. ALGINATO × N)
                    if (individualInputs.length > 0) {
                        for (let rep = 0; rep < baseQty; rep++) {
                            globalStageOrder++;
                            const repNoteNumber = `${batchNumber}-S${globalStageOrder}-R${rep + 1}`;
                            const repItems = individualInputs.map(input => ({
                                componentId: input.productId,
                                componentType: input.inputType || 'RAW_MATERIAL',
                                plannedQuantity: pesajeBaseQuantity
                                    ? input.quantityPerUnit * pesajeBaseQuantity * scaleFactor
                                    : input.quantityPerUnit * scaleFactor,
                                unit: input.unit || 'gramo',
                                notes: null
                            }));

                            const repNote = await prisma.assemblyNote.create({
                                data: {
                                    noteNumber: repNoteNumber,
                                    productionBatchId: batch.id,
                                    productId: stage.outputProductId || batchProductId,
                                    templateId: template.id,
                                    stageId: stage._fromSubTemplate ? null : stage.id,
                                    stageOrder: globalStageOrder,
                                    stageName: `${stage.stageName} — ${rep + 1} de ${baseQty}`,
                                    targetQuantity: noteQty,
                                    unit: noteUnit,
                                    status: 'PENDING',
                                    processTypeId: stage.processTypeId,
                                    processParameters: {
                                        ...(stage.processParameters || {}),
                                        repeatBatch: rep + 1,
                                        repeatTotal: baseQty,
                                        ...(stage._fromSubTemplate ? { fromSubTemplate: stage._fromSubTemplate } : {})
                                    },
                                    createdById: userId || null,
                                    items: { create: repItems }
                                },
                                include: {
                                    items: { include: { component: true } },
                                    processType: true,
                                    product: true
                                }
                            });
                            notes.push(repNote);
                        }
                    }

                    // If ALL inputs are aggregate (no individual), skip the N repetitions entirely
                    if (individualInputs.length === 0 && aggregateInputs.length > 0) {
                        // Already handled above — single note created
                    }
                    continue; // skip the default note creation below
                }

                // ── Default path: no aggregation or single batch ─────────────
                const reps = isPesaje ? baseQty : 1;
                for (let rep = 0; rep < reps; rep++) {
                    globalStageOrder++;
                    const repLabel = (isPesaje && baseQty > 1) ? ` — ${rep + 1} de ${baseQty}` : '';
                    const noteNumber = (isPesaje && baseQty > 1)
                        ? `${batchNumber}-S${globalStageOrder}-R${rep + 1}`
                        : `${batchNumber}-S${globalStageOrder}`;

                    let itemsToCreate = [];
                    const stageInputs = (stage.inputs && stage.inputs.length > 0) ? stage.inputs : formulaInputs;
                    if (stageInputs && stageInputs.length > 0) {
                        // Detect if ENSAMBLE inputs are per-gram ratios vs absolute quantities
                        const ensambleInputsAreRatios = isEnsamble &&
                            stageInputs.length > 0 &&
                            Math.max(...stageInputs.map(i => Math.abs(i.quantityPerUnit || 0)), 0) < 2;

                        itemsToCreate = stageInputs.map((input) => ({
                            componentId: input.productId,
                            componentType: input.inputType || 'RAW_MATERIAL',
                            // Formula-derived inputs (_fromFormula): quantityPerUnit is per-unit (e.g. 1 TARRO per 1 finished unit)
                            //   → simply multiply by noteQty (planned units, e.g. 428)
                            // PESAJE ratios: quantityPerUnit = per-gram ratio → × formula.baseQuantity × baseQty
                            // PESAJE absolute: quantityPerUnit = absolute qty → × baseQty only
                            // ENSAMBLE ratios: quantityPerUnit = per-gram ratio → × noteQty (formula.baseQuantity × baseQty)
                            // ENSAMBLE absolute: quantityPerUnit = absolute qty → × baseQty × scaleFactor
                            // FORMACION from formula: already scaled by baseQty × scaleFactor.
                            // Other: quantityPerUnit × noteQty for scaling.
                            plannedQuantity: input._fromFormula ? input.quantityPerUnit * noteQty
                                : formulaInputs ? input.quantityPerUnit
                                : isPesaje && pesajeBaseQuantity ? input.quantityPerUnit * pesajeBaseQuantity * baseQty * scaleFactor
                                : isPesaje ? input.quantityPerUnit * baseQty * scaleFactor
                                : isEnsamble && ensambleInputsAreRatios ? input.quantityPerUnit * noteQty
                                : isEnsamble ? input.quantityPerUnit * baseQty * scaleFactor
                                : input.quantityPerUnit * noteQty,
                            unit: input.unit || 'gramo',
                            notes: null
                        }));
                    }

                    // Create note first, then items separately (avoids Prisma nested create
                    // silently dropping items when multiple share the same componentId)
                    const note = await prisma.assemblyNote.create({
                        data: {
                            noteNumber,
                            productionBatchId: batch.id,
                            productId: stage.outputProductId || batchProductId,
                            templateId: template.id,
                            stageId: stage._fromSubTemplate ? null : stage.id,
                            stageOrder: globalStageOrder,
                            stageName: `${stage.stageName}${repLabel}`,
                            targetQuantity: noteQty,
                            unit: noteUnit,
                            status: 'PENDING',
                            processTypeId: stage.processTypeId,
                            processParameters: {
                                ...(stage.processParameters || {}),
                                ...(isPesaje && baseQty > 1 ? { repeatBatch: rep + 1, repeatTotal: baseQty } : {}),
                                ...(!isPesaje && baseQty > 1 ? { repeatTotal: baseQty } : {}),
                                ...(stage._fromSubTemplate ? { fromSubTemplate: stage._fromSubTemplate } : {}),
                                ...(flavorKey ? { flavorKey } : {}),
                                ...conteoParams
                            },
                            createdById: userId || null,
                        }
                    });

                    // Create items individually to preserve duplicates (e.g. AZUCAR added twice at different process steps)
                    if (itemsToCreate.length > 0) {
                        await prisma.assemblyNoteItem.createMany({
                            data: itemsToCreate.map(item => ({ ...item, assemblyNoteId: note.id }))
                        });
                    }

                    // Re-fetch with includes for response
                    const fullNote = await prisma.assemblyNote.findUnique({
                        where: { id: note.id },
                        include: {
                            items: { include: { component: true } },
                            processType: true,
                            product: true
                        }
                    });

                    if (fullNote.items.length !== itemsToCreate.length) {
                        console.warn(`[quickStart] ⚠️ Item count mismatch for "${stage.stageName}": expected ${itemsToCreate.length}, got ${fullNote.items.length}`);
                    }

                    notes.push(fullNote);
                }
            }



            res.json({
                batch,
                notes,
                firstNoteId: notes[0]?.id,
                message: `Proceso iniciado: ${notes.length} etapa(s) creadas`
            });
        } catch (error) {
            console.error('Error in quickStart:', error);
            res.status(500).json({ error: error.message });
        }
    }
};

module.exports = assemblyNoteController;
