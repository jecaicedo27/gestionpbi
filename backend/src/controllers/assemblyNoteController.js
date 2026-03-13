const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const assemblyService = require('../services/assemblyService');

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
            res.json(notes);
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
            const isFormacionNote = note.processType?.code === 'FORMACION';
            if (note.status === 'PENDING' && note.stageId && note.targetQuantity && !isFormacionNote) {
                const templateInputs = await prisma.assemblyTemplateStageInput.findMany({
                    where: { stageId: note.stageId },
                    include: { product: { select: { id: true, name: true, sku: true } } },
                    orderBy: { displayOrder: 'asc' }
                });

                if (templateInputs.length > 0) {
                    // Build lookup: productId → current quantityPerUnit
                    const qpuMap = {};
                    for (const ti of templateInputs) {
                        qpuMap[ti.productId] = { qpu: ti.quantityPerUnit, unit: ti.unit, product: ti.product };
                    }

                    // For ENSAMBLE: qpu = absolute qty, use directly (no scaling by targetQuantity)
                    // For PESAJE: SKIP recalculation — quickStart already computed correct
                    // scaled values (handles both absolute and per-gram ratio inputs).
                    // Live recalc would lose the scaling and show raw template values.
                    const isEnsambleNote = note.processType?.code === 'ENSAMBLE';
                    const isPesajeNote = note.processType?.code === 'PESAJE';
                    if (isPesajeNote) {
                        // Keep stored DB values for PESAJE — they are already correct
                        // Just re-sort items to match template order (below)
                    } else {
                    note.items = note.items.map(item => {
                        const current = qpuMap[item.componentId];
                        if (current !== undefined) {
                            return {
                                ...item,
                                plannedQuantity: isEnsambleNote ? current.qpu : current.qpu * note.targetQuantity,
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
                    // Skip virtual item injection for flavor-substituted notes or PESAJE
                    // (their items intentionally differ from the template inputs)
                    const isFlavorSubstituted = note.processParameters?.flavorKey;
                    if (!isFlavorSubstituted && !isPesajeNote) {
                        for (const ti of templateInputs) {
                            if (!existingComponentIds.has(ti.productId)) {
                                note.items.unshift({
                                    id: `virtual_${ti.id}`,
                                    componentId: ti.productId,
                                    component: ti.product,
                                    plannedQuantity: (isEnsambleNote || isPesajeNote) ? ti.quantityPerUnit : ti.quantityPerUnit * note.targetQuantity,
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

                        // Scale and auto-consume EMPAQUE items
                        if (isEmpaque) {
                            const consumedItems = [];
                            for (const item of sibling.items) {
                                const pq = item.plannedQuantity;
                                if (pq == null || pq <= 0) continue;

                                // Scale quantity by conteo actual
                                const scaledQty = Math.abs(scaleFactor - 1) < 0.001 ? pq : pq * scaleFactor;
                                const roundedQty = Math.round(scaledQty);

                                // Update plannedQuantity + set actualQuantity = planned (auto-filled)
                                await prisma.assemblyNoteItem.update({
                                    where: { id: item.id },
                                    data: {
                                        plannedQuantity: scaledQty,
                                        actualQuantity: scaledQty
                                    }
                                });

                                // Auto-consume from MaterialLot in PRODUCTION zone
                                if (item.componentId) {
                                    // Try PRODUCTION zone first, then any zone
                                    let lot = await prisma.materialLot.findFirst({
                                        where: {
                                            productId: item.componentId,
                                            currentQuantity: { gt: 0 },
                                            status: { in: ['AVAILABLE', 'LOW_STOCK'] },
                                            zone: 'PRODUCTION'
                                        },
                                        orderBy: { receivedAt: 'desc' }
                                    });
                                    if (!lot) {
                                        // Fallback: any zone with stock
                                        lot = await prisma.materialLot.findFirst({
                                            where: {
                                                productId: item.componentId,
                                                currentQuantity: { gt: 0 },
                                                status: { in: ['AVAILABLE', 'LOW_STOCK'] }
                                            },
                                            orderBy: { receivedAt: 'desc' }
                                        });
                                    }

                                    if (lot) {
                                        const newQty = Math.max(0, lot.currentQuantity - roundedQty);
                                        await prisma.materialLot.update({
                                            where: { id: lot.id },
                                            data: {
                                                currentQuantity: newQty,
                                                status: newQty <= 0 ? 'DEPLETED'
                                                    : newQty < (lot.initialQuantity * 0.1) ? 'LOW_STOCK'
                                                        : 'AVAILABLE'
                                            }
                                        });

                                        await prisma.lotConsumption.create({
                                            data: {
                                                materialLotId: lot.id,
                                                assemblyNoteId: sibling.id,
                                                quantityUsed: roundedQty,
                                                usedById: req.body.operatorId || null,
                                                observations: `Post-CONTEO auto: ${sibling.stageName} — ${item.component?.name || 'Material'}`
                                            }
                                        });

                                        await prisma.assemblyNoteItem.update({
                                            where: { id: item.id },
                                            data: { lotNumber: lot.lotNumber }
                                        });

                                        consumedItems.push(`${item.component?.name}: ${roundedQty} from ${lot.lotNumber}`);
                                    } else {
                                        // No lot exists anywhere — create a virtual lot for traceability
                                        const now = new Date();
                                        const co = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
                                        const yy = String(co.getFullYear()).slice(-2);
                                        const mm = String(co.getMonth() + 1).padStart(2, '0');
                                        const dd = String(co.getDate()).padStart(2, '0');
                                        const virtualLotNumber = `AUTO-${(item.component?.name || 'MATERIAL').replace(/\s+/g, '-').toUpperCase().slice(0, 30)}-${yy}${mm}${dd}`;

                                        const virtualLot = await prisma.materialLot.create({
                                            data: {
                                                productId: item.componentId,
                                                siigoProductCode: item.component?.sku || '',
                                                siigoProductName: item.component?.name || '',
                                                lotNumber: virtualLotNumber,
                                                initialQuantity: roundedQty,
                                                currentQuantity: 0,
                                                unit: item.unit || item.component?.unit || 'unidad',
                                                receivedAt: now,
                                                status: 'DEPLETED',
                                                zone: 'PRODUCTION'
                                            }
                                        });

                                        await prisma.lotConsumption.create({
                                            data: {
                                                materialLotId: virtualLot.id,
                                                assemblyNoteId: sibling.id,
                                                quantityUsed: roundedQty,
                                                usedById: req.body.operatorId || null,
                                                observations: `Post-CONTEO auto (sin lote): ${sibling.stageName} — ${item.component?.name || 'Material'}`
                                            }
                                        });

                                        await prisma.assemblyNoteItem.update({
                                            where: { id: item.id },
                                            data: { lotNumber: virtualLotNumber }
                                        });

                                        consumedItems.push(`${item.component?.name}: ${roundedQty} (virtual lot: ${virtualLotNumber})`);
                                    }

                                    // Decrement productionZoneStock for non-exempt items
                                    const nameUpper = (item.component?.name || '').toUpperCase();
                                    const isExempt = nameUpper === 'AGUA' || nameUpper.includes('ETIQUETA') || nameUpper.includes('SELLO') || nameUpper.includes('CAJA');
                                    if (!isExempt) {
                                        await prisma.product.update({
                                            where: { id: item.componentId },
                                            data: { productionZoneStock: { decrement: roundedQty } }
                                        });
                                    }
                                }
                            }

                            // Mark EMPAQUE note as pre-consumed + store empaqueData
                            const existingParams = sibling.processParameters || {};
                            await prisma.assemblyNote.update({
                                where: { id: sibling.id },
                                data: {
                                    processParameters: {
                                        ...existingParams,
                                        materialsPreConsumed: true,
                                        preConsumedAt: new Date().toISOString()
                                    },
                                    empaqueData: {
                                        ...(sibling.empaqueData || {}),
                                        conteo_qty: actualCount,
                                        planned_qty: oldTarget
                                    }
                                }
                            });

                            console.log(`[completeNote] CONTEO → EMPAQUE pre-consumed ${sibling.stageName}: ${consumedItems.length} items consumed. Scale: ${scaleFactor.toFixed(3)}`);
                            consumedItems.forEach(c => console.log(`  ✅ ${c}`));
                        } else {
                            // ENSAMBLE: just log the scale update
                            console.log(`[completeNote] CONTEO → Updated ${sibling.stageName}: target ${oldTarget} → ${actualCount} (×${scaleFactor.toFixed(3)}) [${noteProcessType?.code}]`);
                        }
                    }
                }
            } catch (postConteoErr) {
                console.warn('[completeNote] Post-CONTEO update failed (non-critical):', postConteoErr.message);
            }

            res.json(result);
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
            let flavorProductId = null; // resolved output product (ESFERAS [SABOR])
            let flavorCompuestoId = null; // resolved input product (COMPUESTO [SABOR])
            let sizeMap = {}; // resolved output products per size (3400, 1150, 350)
            if (flavorKey) {
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
                    // When a EMPAQUE/ENSAMBLE stage has flavorDependent=true and an outputProductId,
                    // reload its inputs from the formula of that product (e.g. LIQUIPOPS MARACUYA X 350)
                    // to replace the default FRESA/CAFÉ template inputs with the correct flavor's ones.
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
                // If a compuesto sub-template exists for this flavor and differs from default,
                // we need to re-flatten with the correct sub-template stages
                if (compuestoTemplate) {
                    // Find and replace the compuesto sub-template stages in flatStages
                    // The compuesto stages are already flattened from the default (FRESA) template
                    // We need to reload them from the correct flavor template
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
                        // Find indices of compuesto stages (marked with _fromSubTemplate matching default compuesto code)
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
                // Reuse the existing batch (from scheduler) instead of creating a new one
                batch = await prisma.productionBatch.update({
                    where: { id: existingBatchId },
                    data: {
                        status: 'STAGE_1_BASE',
                        startedAt: now,
                        currentStage: 1,
                    }
                });
                console.log(`[quickStart] Reusing existing batch ${batch.batchNumber} (${existingBatchId})`);
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
            const baseQty = quantity || 1;
            let globalStageOrder = 0;

            for (const stage of flatStages) {
                // Skip stages for sizes with 0 planned units (e.g. empaque_1150 when no 1150 was planned)
                if (stage._skipStage) {
                    console.log(`[quickStart] Skipping stage "${stage.stageName}" — zero planned units`);
                    continue;
                }
                const isPesaje = stage.processType?.code === 'PESAJE';
                const isEnsamble = stage.processType?.code === 'ENSAMBLE';

                // ── Resolve noteQty and noteUnit for this stage ──
                // PESAJE inputs can be:
                //   a) Per-gram ratios (e.g. BASE=0.98/g) → need × formula.baseQuantity
                //   b) Absolute quantities (e.g. AGUA=48000g) → use as-is
                // Heuristic: if ALL quantityPerUnit < 2, they're ratios; otherwise absolute.
                // ENSAMBLE: template inputs store ABSOLUTE quantities (e.g. 118004g).
                let noteQty = isPesaje ? 1 : baseQty;
                let noteUnit = 'lote';
                const stageProductId = stage.outputProductId || stage._subTemplateProductId;
                let pesajeBaseQuantity = null; // only set when inputs are per-gram ratios

                if (isPesaje && stageProductId) {
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
                            noteQty = stageFormula.baseQuantity || 1;
                            console.log(`[quickStart] PESAJE "${stage.stageName}" — inputs are per-gram ratios (max=${maxInputQty.toFixed(4)}), scaling by ${stageFormula.baseQuantity}`);
                        } else {
                            // Absolute quantities → use as-is
                            noteQty = stageFormula.baseQuantity || 1;
                            console.log(`[quickStart] PESAJE "${stage.stageName}" — inputs are absolute (max=${maxInputQty}), no scaling`);
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
                    } else {
                        // Generic ENSAMBLE (e.g. "Ensamble Siigo de BASE LIQUIPOPS"):
                        // use formula baseQuantity × baseQty
                        const formula = await prisma.formula.findFirst({
                            where: { productId: ensambleProductId },
                            select: { baseQuantity: true, baseUnit: true },
                            orderBy: { version: 'desc' }
                        });
                        noteQty = (formula?.baseQuantity || 1) * baseQty;
                        noteUnit = formula?.baseUnit || 'gramo';
                    }
                }

                // ── EMPAQUE: resolve planned units from scheduler targets ──
                // EMPAQUE items are per-unit (1 tarro, 2500g esferas per jar).
                // Multiply by the planned jar count (e.g. 40 for 3400g, 100 for 350g).
                const isEmpaque = stage.processType?.code === 'EMPAQUE';
                if (isEmpaque && stage.outputProductId) {
                    const schedulerTarget = (reqOutputTargets || []).find(t => t.productId === stage.outputProductId);
                    const plannedUnits = schedulerTarget?.plannedUnits || 0;
                    if (plannedUnits > 0) {
                        noteQty = plannedUnits;
                        noteUnit = 'unidad';
                        console.log(`[quickStart] EMPAQUE "${stage.stageName}" — ${plannedUnits} planned units`);
                    }
                }

                // ── FORMACION: resolve target quantity and inputs from formula ──
                const isFormacion = stage.processType?.code === 'FORMACION';
                let formulaInputs = null; // populated when template stage has no inputs
                if (isFormacion) {
                    const formacionProductId = stage.outputProductId || stageProductId || template.productId;
                    const formula = await prisma.formula.findFirst({
                        where: { productId: formacionProductId, isActive: true },
                        include: { items: { include: { ingredient: { select: { id: true, name: true } } } } },
                        orderBy: { version: 'desc' }
                    });
                    if (formula) {
                        noteQty = (formula.baseQuantity || 1) * baseQty;
                        noteUnit = formula.baseUnit || 'gramo';
                        // If template stage has no inputs defined, use formula items
                        if (!stage.inputs || stage.inputs.length === 0) {
                            formulaInputs = formula.items.map(fi => ({
                                productId: fi.ingredientId,
                                inputType: 'SEMI_FINISHED',
                                quantityPerUnit: fi.quantity * baseQty,
                                unit: fi.unit || 'gramo'
                            }));
                        }
                    }
                }

                // ── CONTEO: enrich with conteo map from sizeMap ──
                const isConteo = stage.processType?.code === 'CONTEO';
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
                                ? input.quantityPerUnit * pesajeBaseQuantity * baseQty
                                : input.quantityPerUnit * baseQty,
                            unit: input.unit || 'gramo',
                            notes: null
                        }));

                        const aggNote = await prisma.assemblyNote.create({
                            data: {
                                noteNumber: aggNoteNumber,
                                productionBatchId: batch.id,
                                productId: stage.outputProductId || batchProductId,
                                templateId: template.id,
                                stageId: stage._fromSubTemplate ? null : stage.id,
                                stageOrder: globalStageOrder,
                                stageName: `${stage.stageName} — Total ${baseQty} lotes`,
                                targetQuantity: baseQty,
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
                                    ? input.quantityPerUnit * pesajeBaseQuantity
                                    : input.quantityPerUnit,
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
                        itemsToCreate = stageInputs.map((input) => ({
                            componentId: input.productId,
                            componentType: input.inputType || 'RAW_MATERIAL',
                            // PESAJE ratios: quantityPerUnit = per-gram ratio → × formula.baseQuantity × baseQty
                            // PESAJE absolute: quantityPerUnit = absolute qty → × baseQty only
                            // ENSAMBLE: quantityPerUnit = absolute qty → × baseQty
                            // FORMACION from formula: already scaled by baseQty.
                            // Other: quantityPerUnit × noteQty for scaling.
                            plannedQuantity: formulaInputs ? input.quantityPerUnit
                                : isPesaje && pesajeBaseQuantity ? input.quantityPerUnit * pesajeBaseQuantity * baseQty
                                : (isPesaje || isEnsamble) ? input.quantityPerUnit * baseQty
                                : input.quantityPerUnit * noteQty,
                            unit: input.unit || 'gramo',
                            notes: null
                        }));
                    }

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
                            items: { create: itemsToCreate }
                        },
                        include: {
                            items: { include: { component: true } },
                            processType: true,
                            product: true
                        }
                    });

                    notes.push(note);
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
