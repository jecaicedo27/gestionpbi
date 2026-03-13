const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const browserManager = require('./siigoBrowserManager');

// Strip accents for flavor-insensitive matching (CAFE ↔ CAFÉ)
const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Service to handle Assembly Notes generation and management
 */
class AssemblyService {
    /**
     * Generates Assembly Notes for a Production Batch based on its Product's Template
     * @param {string} batchId - The ID of the ProductionBatch
     * @returns {Promise<Object>} - The generated notes
     */
    async generateNotesForBatch(batchId, templateId = null) {
        try {
            // 1. Get Batch
            const batch = await prisma.productionBatch.findUnique({
                where: { id: batchId },
                include: {
                    product: {
                        include: {
                            templates: {
                                where: { isActive: true },
                                orderBy: { version: 'desc' },
                                take: 1,
                                include: {
                                    stages: {
                                        include: {
                                            processType: true,
                                            inputs: {
                                                include: { product: true }
                                            },
                                            outputProduct: true
                                        },
                                        orderBy: { stageOrder: 'asc' }
                                    }
                                }
                            },
                            formulas: {
                                where: { isActive: true },
                                orderBy: { version: 'desc' },
                                take: 1,
                                include: { items: true }
                            }
                        }
                    },
                    outputTargets: {
                        include: { product: true }
                    }
                }
            });

            if (!batch) throw new Error('Batch not found');

            let template;

            // 2A. If templateId provided directly (scheduler batches without productId)
            if (templateId) {
                template = await prisma.assemblyTemplate.findUnique({
                    where: { id: templateId },
                    include: {
                        product: true,
                        stages: {
                            include: {
                                processType: true,
                                inputs: { include: { product: true }, orderBy: { displayOrder: 'asc' } },
                                outputProduct: true,
                                subTemplate: {
                                    include: {
                                        product: true,
                                        stages: {
                                            include: {
                                                processType: true,
                                                inputs: { include: { product: true }, orderBy: { displayOrder: 'asc' } },
                                                outputProduct: true
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
                if (!template) throw new Error(`Template ${templateId} not found`);
            } else {
                // 2B. Legacy path: look up via batch.product.templates
                template = batch.product?.templates[0];
                if (!template) throw new Error(`No active template found for product ${batch.product?.name || batch.flavor || 'unknown'}`);
            }

            const generatedNotes = [];

            // 2b. Flatten stages: expand sub-templates into their child stages
            const flatStages = [];
            const batchFlavorForResolve = batch.flavor || '';
            for (const stage of template.stages) {
                if (stage.subTemplateId && stage.subTemplate?.stages?.length > 0) {
                    let subTmpl = stage.subTemplate;

                    // ── Dynamic COMPUESTO resolution by flavor ──
                    // If sub-template is a COMPUESTO but the batch flavor differs,
                    // find the correct COMPUESTO template for this flavor
                    if (batchFlavorForResolve && subTmpl.product?.name?.toUpperCase().includes('COMPUESTO')) {
                        const subFlavor = (subTmpl.product.name.match(/COMPUESTO\s+(.+)/i) || [])[1] || '';
                        if (subFlavor.toUpperCase() !== batchFlavorForResolve.toUpperCase()) {
                            const flavorCompuesto = await prisma.assemblyTemplate.findFirst({
                                where: {
                                    isActive: true,
                                    templateName: { contains: `COMPUESTO ${batchFlavorForResolve}`, mode: 'insensitive' }
                                },
                                include: {
                                    product: true,
                                    stages: {
                                        include: {
                                            processType: true,
                                            inputs: { include: { product: true }, orderBy: { displayOrder: 'asc' } },
                                            outputProduct: true
                                        },
                                        orderBy: { stageOrder: 'asc' }
                                    }
                                }
                            });
                            if (flavorCompuesto?.stages?.length > 0) {
                                console.log(`[generateNotes] 🔄 Resolved COMPUESTO: ${subTmpl.templateCode} → ${flavorCompuesto.templateCode} for flavor ${batchFlavorForResolve}`);
                                subTmpl = flavorCompuesto;
                            } else {
                                console.warn(`[generateNotes] ⚠️ No COMPUESTO template for flavor ${batchFlavorForResolve} — using default ${subTmpl.templateCode}`);
                            }
                        }
                    }

                    console.log(`[generateNotes] Expanding sub-template ${subTmpl.templateCode} (${subTmpl.stages.length} stages)`);
                    for (const subStage of subTmpl.stages) {
                        flatStages.push({
                            ...subStage,
                            _fromSubTemplate: subTmpl.templateCode,
                            _subTemplateProductId: subTmpl.productId
                        });
                    }
                } else {
                    flatStages.push(stage);
                }
            }


            // NOTE: PROTECCION is prepared separately via Premezclas panel.
            // The frontend checks stock via /api/assembly-notes/:id/check-proteccion
            // before allowing advancement past the COMPUESTO stage.

            console.log(`[generateNotes] Template "${template.templateCode || templateId}" — original: ${template.stages.length}, flat: ${flatStages.length}`);

            // 2. Wrap in a transaction
            let globalStageOrder = 0;
            await prisma.$transaction(async (tx) => {
                for (const stage of flatStages) {
                    globalStageOrder++;
                    // Generate a unique note number using timestamp to avoid collisions
                    const ts = Date.now().toString().slice(-8); // Last 8 digits of timestamp
                    const noteNumber = `ANTE-${batch.batchNumber.replace(/^B-\d+-/, '').replace(/-/g, '')}-${ts}-S${globalStageOrder}`;

                    // targetQuantity: for PESAJE stages with a sub-template product, use the formula quantity
                    const isPesaje = stage.processType?.code === 'PESAJE';
                    const isEnsamble = stage.processType?.code === 'ENSAMBLE';
                    const isConteo = stage.processType?.code === 'CONTEO';
                    const isEmpaque = stage.processType?.code === 'EMPAQUE';
                    let targetQuantity = 1;
                    let targetUnit = 'lote';

                    // For sub-template stages, look up the formula to get real batch quantity
                    const stageProductId = stage.outputProductId || stage._subTemplateProductId;
                    if (isPesaje && stageProductId) {
                        const stageFormula = await prisma.formula.findFirst({
                            where: { productId: stageProductId, isActive: true },
                            select: { baseQuantity: true, baseUnit: true },
                            orderBy: { version: 'desc' }
                        });
                        if (stageFormula) {
                            targetQuantity = stageFormula.baseQuantity || 1;
                            targetUnit = stageFormula.baseUnit || 'gramo';
                        }
                    }
                    if (isEnsamble) {
                        const ensambleProductId = stage.outputProductId || stageProductId || template.productId;
                        const formula = await prisma.formula.findFirst({
                            where: { productId: ensambleProductId },
                            select: { baseQuantity: true, baseUnit: true },
                            orderBy: { version: 'desc' }
                        });
                        if (formula) {
                            targetQuantity = formula.baseQuantity || 1;
                            targetUnit = formula.baseUnit || 'gramo';
                        }
                    }

                    // FORMACIÓN: use ESFERAS formula baseQuantity (150,000g standard)
                    // Template is generic (BATCH-LIQUIPOPS) for all flavors, so:
                    // 1. Try batch product formula
                    // 2. Try ESFERAS {flavor} formula
                    // 3. Fallback to any ESFERAS formula (all share same baseQuantity)
                    const isFormacion = stage.processType?.code === 'FORMACION';
                    if (isFormacion) {
                        let formacionFormula = await prisma.formula.findFirst({
                            where: { productId: batch.productId || template.productId, isActive: true },
                            select: { baseQuantity: true, baseUnit: true },
                            orderBy: { version: 'desc' }
                        });
                        if (!formacionFormula && batch.flavor) {
                            // Try ESFERAS {flavor}
                            const esferasProduct = await prisma.product.findFirst({
                                where: { name: { equals: `ESFERAS ${batch.flavor}`, mode: 'insensitive' } }
                            });
                            if (esferasProduct) {
                                formacionFormula = await prisma.formula.findFirst({
                                    where: { productId: esferasProduct.id, isActive: true },
                                    select: { baseQuantity: true, baseUnit: true },
                                    orderBy: { version: 'desc' }
                                });
                            }
                        }
                        if (!formacionFormula) {
                            // Fallback: any ESFERAS formula (all use same 150,000g standard)
                            const anyEsferas = await prisma.product.findFirst({
                                where: { name: { startsWith: 'ESFERAS', mode: 'insensitive' } }
                            });
                            if (anyEsferas) {
                                formacionFormula = await prisma.formula.findFirst({
                                    where: { productId: anyEsferas.id, isActive: true },
                                    select: { baseQuantity: true, baseUnit: true },
                                    orderBy: { version: 'desc' }
                                });
                            }
                        }
                        if (formacionFormula) {
                            targetQuantity = formacionFormula.baseQuantity || 150000;
                            targetUnit = formacionFormula.baseUnit || 'g';
                        } else {
                            targetQuantity = 150000;
                            targetUnit = 'g';
                            console.warn('[generateNotes] ⚠️ No ESFERAS formula found — using default 150,000g for FORMACION');
                        }
                    }

                    // Determine productId: stage output → batch product → template product
                    const resolvedProductId = stage.outputProductId || batch.productId || template.productId;
                    if (!resolvedProductId) {
                        throw new Error(`No se pudo determinar el producto para la etapa "${stage.stageName}". La plantilla debe tener un producto asociado.`);
                    }

                    // ── OutputTargets enrichment for CONTEO / EMPAQUE / final ENSAMBLE ──
                    const outputTargets = batch.outputTargets || [];
                    let noteProcessParams = {
                        ...(stage.processParameters || {}),
                        ...(stage._fromSubTemplate ? { fromSubTemplate: stage._fromSubTemplate } : {})
                    };
                    let noteStatus = 'PENDING';
                    let noteActualQty = null;
                    let noteObservations = null;

                    if (isConteo && outputTargets.length > 0) {
                        // Set CONTEO targetQuantity = sum of all plannedUnits
                        const totalPlanned = outputTargets.reduce((s, t) => s + (t.plannedUnits || 0), 0);
                        targetQuantity = totalPlanned || 1;
                        // Build conteo map keyed by product name
                        const conteoMap = {};
                        for (const t of outputTargets) {
                            const pName = t.product?.name || 'Producto';
                            conteoMap[pName] = {
                                planned: t.plannedUnits || 0,
                                actual: 0,
                                productId: t.productId,
                                productName: pName,
                                esferas: 0,
                                esfera_factor: 0
                            };
                        }
                        noteProcessParams.conteo = conteoMap;
                    }

                    if ((isEmpaque || (isEnsamble && stage.stageName?.includes('LIQUIPOPS'))) && outputTargets.length > 0) {
                        // Match the stage to an outputTarget by product name in stageName
                        const matchedTarget = outputTargets.find(t => {
                            const pName = t.product?.name || '';
                            return stage.stageName?.includes('3400') && pName.includes('3400')
                                || stage.stageName?.includes('1150') && pName.includes('1150')
                                || stage.stageName?.includes('350') && pName.includes('350');
                        });

                        if (matchedTarget) {
                            targetQuantity = matchedTarget.plannedUnits || 1;
                            noteProcessParams.product_id = matchedTarget.productId;

                            // Auto-skip 0-unit steps
                            if (matchedTarget.plannedUnits === 0) {
                                noteStatus = 'COMPLETED';
                                noteActualQty = 0;
                                noteObservations = 'Omitido — 0 unidades planificadas para esta referencia';
                                console.log(`[generateNotes] ⏭️ Auto-skipped ${stage.stageName} (0 planned units)`);
                            }
                        }
                    }

                    // Create Assembly Note
                    const note = await tx.assemblyNote.create({
                        data: {
                            noteNumber,
                            productId: resolvedProductId,
                            productionBatchId: batch.id,
                            templateId: template.id,
                            stageId: stage._fromSubTemplate ? null : stage.id,
                            stageOrder: globalStageOrder,
                            stageName: stage.stageName,
                            targetQuantity,
                            unit: targetUnit,
                            status: noteStatus,
                            ...(noteActualQty !== null ? { actualQuantity: noteActualQty } : {}),
                            ...(noteObservations ? { observations: noteObservations, completedAt: new Date() } : {}),
                            processTypeId: stage.processTypeId,
                            processParameters: noteProcessParams
                        }
                    });

                    // Create Note Items (inputs)
                    if (stage.inputs && stage.inputs.length > 0) {
                        for (const input of stage.inputs) {
                            // Template inputs store ABSOLUTE quantities per batch (e.g. AGUA = 48,000g)
                            // so plannedQuantity = quantityPerUnit directly (no scaling needed)
                            const plannedQuantity = input.quantityPerUnit;

                            // ── Dynamic flavor resolution for flavor-specific components ──
                            // Template may have CAFÉ products hardcoded (default flavor).
                            // Swap to the correct flavor based on batch flavor.
                            let resolvedComponentId = input.productId;
                            const inputName = (input.product?.name || '').toUpperCase();
                            const batchFlavor = (batch.flavor || '').toUpperCase();

                            // Only resolve if batch has a flavor and the component is flavor-specific
                            const flavorKeywords = ['ESFERAS', 'PROTECCION', 'ETIQUETA'];
                            const isFlavorSpecific = flavorKeywords.some(kw => inputName.includes(kw));

                            if (batchFlavor && isFlavorSpecific) {
                                const inputFlavorNorm = stripAccents(inputName);
                                const batchFlavorNorm = stripAccents(batchFlavor);

                                if (!inputFlavorNorm.includes(batchFlavorNorm)) {
                                    // Strategy 1: For simple products (ESFERAS X, PROTECCION X),
                                    // construct target name directly: PREFIX + BATCH_FLAVOR
                                    let flavorProduct = null;
                                    const simplePrefix = ['ESFERAS', 'PROTECCION'].find(kw => inputName.startsWith(kw));
                                    if (simplePrefix) {
                                        const directName = `${simplePrefix} ${batchFlavor}`;
                                        flavorProduct = await tx.product.findFirst({
                                            where: { name: { equals: directName, mode: 'insensitive' } },
                                            select: { id: true, name: true }
                                        });
                                    }

                                    // Strategy 2: For complex names (ETIQUETA LIQUIPOPS SABOR A CAFE X 350 GR),
                                    // replace the old flavor with the batch flavor using known flavors list
                                    if (!flavorProduct) {
                                        const knownFlavors = ['MANGO BICHE CON SAL', 'MANGO BICHE', 'ICE PINK', 'FRESA', 'CAFE', 'CAFÉ', 'LYCHE', 'LYCHEE', 'CHICLE', 'MARACUYA'];
                                        let searchName = inputName;
                                        for (const flv of knownFlavors) {
                                            if (stripAccents(inputName).includes(stripAccents(flv))) {
                                                searchName = inputName.replace(new RegExp(flv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), batchFlavor);
                                                break;
                                            }
                                        }
                                        // Try exact match first
                                        flavorProduct = await tx.product.findFirst({
                                            where: { name: { equals: searchName, mode: 'insensitive' } },
                                            select: { id: true, name: true }
                                        });
                                        // Fallback: contains-based search for double-space edge cases
                                        if (!flavorProduct && searchName !== inputName) {
                                            flavorProduct = await tx.product.findFirst({
                                                where: { name: { contains: batchFlavor, mode: 'insensitive' },
                                                    AND: flavorKeywords.filter(kw => inputName.includes(kw)).map(kw => ({ name: { contains: kw, mode: 'insensitive' } }))
                                                },
                                                select: { id: true, name: true }
                                            });
                                            // If multiple matches, find best match by checking size suffix
                                            if (flavorProduct) {
                                                const sizeMatch = inputName.match(/(\d+)\s*(GR|ML|G)/i);
                                                if (sizeMatch) {
                                                    const sizedProduct = await tx.product.findFirst({
                                                        where: { name: { contains: batchFlavor, mode: 'insensitive' },
                                                            AND: [
                                                                ...flavorKeywords.filter(kw => inputName.includes(kw)).map(kw => ({ name: { contains: kw, mode: 'insensitive' } })),
                                                                { name: { contains: sizeMatch[1], mode: 'insensitive' } }
                                                            ]
                                                        },
                                                        select: { id: true, name: true }
                                                    });
                                                    if (sizedProduct) flavorProduct = sizedProduct;
                                                }
                                            }
                                        }
                                    }

                                    if (flavorProduct) {
                                        console.log(`[generateNotes] 🔄 Flavor swap: ${inputName} → ${flavorProduct.name}`);
                                        resolvedComponentId = flavorProduct.id;
                                    } else {
                                        console.warn(`[generateNotes] ⚠️ No flavor swap found for "${inputName}" with flavor "${batchFlavor}" — keeping original`);
                                    }
                                }
                            }

                            await tx.assemblyNoteItem.create({
                                data: {
                                    assemblyNoteId: note.id,
                                    componentId: resolvedComponentId,
                                    componentType: input.inputType || 'RAW_MATERIAL',
                                    plannedQuantity,
                                    unit: input.unit
                                }
                            });
                        }
                    }

                    generatedNotes.push(note);
                }
            });

            return {
                success: true,
                batchId,
                notesCount: generatedNotes.length,
                notes: generatedNotes
            };
        } catch (error) {
            console.error('Error generating assembly notes:', error);
            throw error;
        }
    }

    /**
     * Validates if all materials for a specific note are available
     * @param {string} noteId 
     */
    async validateMaterialAvailability(noteId) {
        const note = await prisma.assemblyNote.findUnique({
            where: { id: noteId },
            include: {
                items: {
                    include: { component: true }
                }
            }
        });

        if (!note) throw new Error('Assembly Note not found');

        const availability = [];
        let isFullyAvailable = true;

        for (const item of note.items) {
            if (item.componentType === 'FROM_PREVIOUS_STAGE') {
                const prevStageNote = await prisma.assemblyNote.findFirst({
                    where: {
                        productionBatchId: note.productionBatchId,
                        stageOrder: { lt: note.stageOrder }
                    },
                    orderBy: { stageOrder: 'desc' }
                });

                const isAvailable = prevStageNote && prevStageNote.status === 'COMPLETED';
                availability.push({
                    itemId: item.id,
                    productId: item.componentId,
                    productName: `Output Etapa Anterior`,
                    required: item.plannedQuantity,
                    available: isAvailable ? item.plannedQuantity : 0,
                    status: isAvailable ? 'OK' : 'WAITING_PREV_STAGE'
                });
                if (!isAvailable) isFullyAvailable = false;
            } else {
                const stock = item.component?.currentStock || 0;
                const isAvailable = stock >= item.plannedQuantity;

                availability.push({
                    itemId: item.id,
                    productId: item.componentId,
                    productName: item.component?.name || 'Unknown',
                    required: item.plannedQuantity,
                    available: stock,
                    status: isAvailable ? 'OK' : 'SHORTAGE'
                });
                if (!isAvailable) isFullyAvailable = false;
            }
        }

        return {
            noteId,
            isFullyAvailable,
            materials: availability
        };
    }

    /**
     * Starts a note execution — sets status to EXECUTING.
     * Inventory consumption is deferred to process completion to avoid
     * premature stock decrements when the operator hasn't finished weighing.
     */
    async consumeMaterialsAndStart(noteId, operatorId) {
        return await prisma.$transaction(async (tx) => {
            const note = await tx.assemblyNote.findUnique({
                where: { id: noteId },
                include: {
                    processType: true,
                    items: { include: { component: true } }
                }
            });

            if (!note) throw new Error('Note not found');
            if (note.status !== 'PENDING') throw new Error('Note is not in PENDING status');

            // ── ZONE STOCK VALIDATION at START ──
            const processCode = note.processType?.code;
            const consumingStage = processCode === 'PESAJE';

            if (consumingStage && (note.items || []).length > 0) {
                let zoneValidationEnabled = true;
                try {
                    const sysConfig = await tx.systemSettings.findUnique({ where: { key: 'PRODUCTION_CONFIG' } });
                    if (sysConfig?.value?.zone_validation_enabled === false) {
                        zoneValidationEnabled = false;
                    }
                } catch (e) { /* default to enabled */ }

                if (zoneValidationEnabled) {
                    const shortages = [];
                    for (const item of note.items) {
                        if (!item.componentId) continue;
                        const qty = item.plannedQuantity || 0;
                        if (qty <= 0) continue;

                        const product = await tx.product.findUnique({
                            where: { id: item.componentId },
                            select: { name: true, productionZoneStock: true, unit: true }
                        });
                        // AGUA is tap water — always available in zone, skip validation
                        if (product && product.name.toUpperCase() === 'AGUA') continue;
                        // Packaging materials (etiquetas, sellos, cajas) don't require zone transfer
                        const nameUpper = product?.name?.toUpperCase() || '';
                        if (nameUpper.includes('ETIQUETA') || nameUpper.includes('SELLO') || nameUpper.includes('CAJA')) continue;
                        if (product && (product.productionZoneStock || 0) < qty * 0.995) {
                            const unit = product.unit || 'und';
                            const fmtQty = (v) => unit === 'gramo' ? `${v.toLocaleString('es-CO')}g (${(v/1000).toFixed(1)}kg)` : `${v} ${unit}`;
                            shortages.push(
                                `${product.name}: necesita ${fmtQty(qty)}, zona tiene ${fmtQty(product.productionZoneStock || 0)}`
                            );
                        }
                    }
                    if (shortages.length > 0) {
                        throw new Error(
                            `⛔ BLOQUEADO: Insumos insuficientes en Zona de Producción.\n` +
                            shortages.join('\n') +
                            `\n\nIngrese los materiales desde el módulo "Zona de Producción" antes de iniciar.`
                        );
                    }
                }
            }

            // ── ZONE VALIDATION for ESFERIFICACION/FORMACION: check packaging materials ──
            // Before starting esferas production, validate that tarros, tapas, liners
            // are available in the production zone (from EMPAQUE sibling notes).
            if (['ESFERIFICACION', 'FORMACION'].includes(processCode) && note.productionBatchId) {
                let zoneValidationEnabled = true;
                try {
                    const sysConfig = await tx.systemSettings.findUnique({ where: { key: 'PRODUCTION_CONFIG' } });
                    if (sysConfig?.value?.zone_validation_enabled === false) {
                        zoneValidationEnabled = false;
                    }
                } catch (e) { /* default to enabled */ }

                if (zoneValidationEnabled) {
                    // Find sibling EMPAQUE notes in the same batch
                    const empaqueNotes = await tx.assemblyNote.findMany({
                        where: {
                            productionBatchId: note.productionBatchId,
                            processType: { code: 'EMPAQUE' }
                        },
                        include: { items: { include: { component: { select: { name: true, productionZoneStock: true, unit: true } } } } }
                    });

                    const shortages = [];
                    // Only validate physical containers: TARRO, TAPA, LINER
                    // SELLO, ETIQUETA, CAJA are labeling items — not in production zone
                    // Note: SELLO names contain 'TARRO' (e.g. "SELLO DE SEGURIDAD TARRO...") — exclude first
                    for (const empNote of empaqueNotes) {
                        for (const item of empNote.items) {
                            if (!item.componentId || !item.component) continue;
                            const nameUpper = item.component.name.toUpperCase();
                            // Skip labeling items (SELLO, ETIQUETA, CAJA) — must check BEFORE TARRO
                            if (nameUpper.includes('SELLO') || nameUpper.includes('ETIQUETA') || nameUpper.includes('CAJA')) continue;
                            const isPackaging = nameUpper.includes('TARRO') || nameUpper.includes('TAPA') || nameUpper.includes('LINER');
                            if (!isPackaging) continue;

                            const qty = item.plannedQuantity || 0;
                            if (qty <= 0) continue;
                            const zoneStock = item.component.productionZoneStock || 0;
                            if (zoneStock < qty * 0.995) {
                                const unit = item.component.unit || 'und';
                                const fmtQty = (v) => unit === 'gramo' ? `${v.toLocaleString('es-CO')}g (${(v/1000).toFixed(1)}kg)` : `${v} ${unit}`;
                                shortages.push(
                                    `${item.component.name}: necesita ${fmtQty(qty)}, zona tiene ${fmtQty(zoneStock)}`
                                );
                            }
                        }
                    }
                    if (shortages.length > 0) {
                        throw new Error(
                            `⛔ BLOQUEADO: Insumos de empaque insuficientes en Zona de Producción.\n` +
                            shortages.join('\n') +
                            `\n\nIngrese tarros, tapas y liners desde el módulo "Zona de Producción" antes de iniciar esferificación.`
                        );
                    }
                }
            }

            // Update Note status to EXECUTING
            await tx.assemblyNote.update({
                where: { id: noteId },
                data: {
                    status: 'EXECUTING',
                    executedById: operatorId,
                    startedAt: new Date()
                }
            });

            // NOTE: Inventory consumption removed from start phase.
            // Stock is consumed when process completes (lot-based consumption
            // on frontend handleComplete + Siigo RPA assembly note).

            return { success: true, noteId, status: 'EXECUTING' };
        });
    }

    /**
     * Record actual quantity weighed and lot number for a specific input item
     */
    async recordActualQuantity(noteId, itemId, actualQty, operatorId, lotNumber) {
        const item = await prisma.assemblyNoteItem.findUnique({
            where: { id: itemId }
        });
        if (!item) throw new Error('Item not found');
        if (item.assemblyNoteId !== noteId) throw new Error('Item does not belong to this note');

        const updateData = {
            actualQuantity: actualQty,
            consumed: true,
            consumedAt: new Date(),
            consumedById: operatorId
        };
        if (lotNumber !== undefined && lotNumber !== null) {
            updateData.lotNumber = lotNumber;
        }

        return await prisma.assemblyNoteItem.update({
            where: { id: itemId },
            data: updateData
        });
    }

    /**
     * Complete a note: record actual output, consume input ingredients,
     * and update output product inventory — all in a single transaction.
     *
     * @param {string} noteId
     * @param {Object} opts
     * @param {number}  opts.actualQuantity
     * @param {string}  opts.observations
     * @param {string}  opts.operatorId
     * @param {Object}  opts.lotSelections - Map of itemId → lotId (from frontend)
     */
    async completeNote(noteId, { actualQuantity, observations, operatorId, lotSelections }) {
        const result = await prisma.$transaction(async (tx) => {
            const note = await tx.assemblyNote.findUnique({
                where: { id: noteId },
                include: {
                    product: true,
                    productionBatch: true,
                    processType: true,
                    items: { include: { component: true } }
                }
            });

            if (!note) throw new Error('Note not found');
            if (note.status === 'COMPLETED') throw new Error('Note already completed');

            // Update note
            const updatedNote = await tx.assemblyNote.update({
                where: { id: noteId },
                data: {
                    status: 'COMPLETED',
                    actualQuantity: actualQuantity || note.targetQuantity,
                    observations,
                    completedAt: new Date(),
                    completedById: operatorId
                }
            });

            // ── CONTEO completion: log actual counts (plannedUnits preserved from scheduler) ──
            // Downstream EMPAQUE/ENSAMBLE read actuals from processParameters.conteo directly
            if (note.processType?.code === 'CONTEO') {
                const conteoMap = note.processParameters?.conteo;
                if (conteoMap && typeof conteoMap === 'object') {
                    for (const [productName, data] of Object.entries(conteoMap)) {
                        if (data.productId && data.actual != null) {
                            console.log(`[completeNote] CONTEO actual: ${productName} → ${data.actual} units`);
                        }
                    }
                }
            }

            // ── ZONE STOCK VALIDATION — block if insufficient production zone stock ──
            const processCode = note.processType?.code;
            // Zone validation only for PESAJE — EMPAQUE items are auto-assigned at INPUT time
            const shouldValidateZone = processCode === 'PESAJE';
            // Auto-consume for PESAJE (raw materials) + EMPAQUE (exempt items: etiquetas, sellos, cajas)
            const canAutoConsume = ['PESAJE', 'EMPAQUE'].includes(processCode);

            if (shouldValidateZone && (note.items || []).length > 0) {
                // Check if zone validation is enabled (default: true)
                let zoneValidationEnabled = true;
                try {
                    const sysConfig = await tx.systemSettings.findUnique({ where: { key: 'PRODUCTION_CONFIG' } });
                    if (sysConfig?.value?.zone_validation_enabled === false) {
                        zoneValidationEnabled = false;
                    }
                } catch (e) { /* default to enabled */ }

                if (zoneValidationEnabled) {
                    const shortages = [];
                    for (const item of note.items) {
                        if (!item.componentId) continue;
                        const qty = item.actualQuantity || item.plannedQuantity || 0;
                        if (qty <= 0) continue;

                        const product = await tx.product.findUnique({
                            where: { id: item.componentId },
                            select: { name: true, productionZoneStock: true, unit: true }
                        });
                        // AGUA is tap water — always available in zone, skip validation
                        if (product && product.name.toUpperCase() === 'AGUA') continue;
                        // Packaging materials (etiquetas, sellos, cajas) don't require zone transfer
                        const nameUpper2 = product?.name?.toUpperCase() || '';
                        if (nameUpper2.includes('ETIQUETA') || nameUpper2.includes('SELLO') || nameUpper2.includes('CAJA')) continue;
                        if (product && product.productionZoneStock < qty * 0.995) {
                            const unit = product.unit || 'und';
                            const fmtQty = (v) => unit === 'gramo' ? `${v.toLocaleString('es-CO')}g (${(v/1000).toFixed(1)}kg)` : `${v} ${unit}`;
                            shortages.push(
                                `${product.name}: necesita ${fmtQty(qty)}, zona tiene ${fmtQty(product.productionZoneStock)}`
                            );
                        }
                    }
                    if (shortages.length > 0) {
                        throw new Error(
                            `⛔ BLOQUEADO: Insumos insuficientes en Zona de Producción.\n` +
                            shortages.join('\n') +
                            `\n\nIngrese los materiales desde el módulo "Zona de Producción" antes de continuar.`
                        );
                    }
                }
            }

            // ── Consume input ingredients from their MaterialLots ──
            if (lotSelections && typeof lotSelections === 'object') {
                for (const [itemId, lotId] of Object.entries(lotSelections)) {
                    if (!lotId) continue;

                    const item = (note.items || []).find(i => i.id === itemId);
                    if (!item || !item.actualQuantity || item.actualQuantity <= 0) continue;

                    const lot = await tx.materialLot.findUnique({ where: { id: lotId } });
                    if (!lot) {
                        console.warn(`[completeNote] Lot ${lotId} not found, skipping`);
                        continue;
                    }

                    const qtyToConsume = Math.round(item.actualQuantity);
                    const newQty = Math.max(0, lot.currentQuantity - qtyToConsume);

                    // Decrement lot quantity
                    await tx.materialLot.update({
                        where: { id: lotId },
                        data: {
                            currentQuantity: newQty,
                            status: newQty <= 0 ? 'DEPLETED'
                                : newQty < (lot.initialQuantity * 0.1) ? 'LOW_STOCK'
                                    : 'AVAILABLE'
                        }
                    });

                    // Record consumption for traceability
                    await tx.lotConsumption.create({
                        data: {
                            materialLotId: lotId,
                            assemblyNoteId: noteId,
                            quantityUsed: qtyToConsume,
                            usedById: operatorId,
                            observations: `${note.stageName || 'Producción'} — ${item.component?.name || 'Material'}`
                        }
                    });

                    // Decrement production zone stock (Siigo sync handles currentStock)
                    await tx.product.update({
                        where: { id: item.componentId },
                        data: { productionZoneStock: { decrement: qtyToConsume } }
                    });
                }
            }

            // ── Auto-consume items without explicit lot selection ──
            // WHITELIST: Only PESAJE and EMPAQUE stages auto-consume inventory.
            // - PESAJE: consumes formula raw materials (azúcar, sabores, colores, etc.)
            // - EMPAQUE: consumes packaging materials (tarros, tapas, liners, sellos, etiquetas, cajas)
            // All other stages (COCCION, ENFRIAMIENTO, ENSAMBLE, CONTEO, FORMACION, etc.)
            // must NOT auto-consume because they share the same items as PESAJE and
            // would cause double deductions.
            // (processCode and canAutoConsume already defined in zone validation block above)
            const consumedItemIds = new Set(
                lotSelections ? Object.keys(lotSelections).filter(k => lotSelections[k]) : []
            );

            // ── Skip auto-consume if Post-CONTEO already pre-consumed these items ──
            // When CONTEO completes, it pre-consumes EMPAQUE items and sets
            // materialsPreConsumed=true. If we auto-consume again here, it's a double-decrement.
            const alreadyPreConsumed = note.processParameters?.materialsPreConsumed === true;

            if (canAutoConsume && !alreadyPreConsumed) {
                for (const item of (note.items || [])) {
                    if (consumedItemIds.has(item.id)) continue; // Already consumed above
                    if (!item.componentId) continue;
                    // Use actualQuantity if set, otherwise fall back to plannedQuantity
                    const qty = item.actualQuantity || item.plannedQuantity || 0;
                    if (qty <= 0) continue;

                    // Find the most recent available lot for this component
                    // Look for lots in PRODUCTION zone first, fallback to any
                    const autoLot = await tx.materialLot.findFirst({
                        where: {
                            productId: item.componentId,
                            currentQuantity: { gt: 0 },
                            status: { in: ['AVAILABLE', 'LOW_STOCK'] },
                            zone: 'PRODUCTION'
                        },
                        orderBy: { receivedAt: 'desc' }
                    });

                    if (autoLot) {
                        const qtyToConsume = Math.round(qty);
                        const newQty = Math.max(0, autoLot.currentQuantity - qtyToConsume);

                        await tx.materialLot.update({
                            where: { id: autoLot.id },
                            data: {
                                currentQuantity: newQty,
                                status: newQty <= 0 ? 'DEPLETED'
                                    : newQty < (autoLot.initialQuantity * 0.1) ? 'LOW_STOCK'
                                        : 'AVAILABLE'
                            }
                        });

                        await tx.lotConsumption.create({
                            data: {
                                materialLotId: autoLot.id,
                                assemblyNoteId: noteId,
                                quantityUsed: qtyToConsume,
                                usedById: operatorId,
                                observations: `${note.stageName || 'Producción'} — ${item.component?.name || 'Material'} (auto)`
                            }
                        });

                        if (item.componentId) {
                            await tx.product.update({
                                where: { id: item.componentId },
                                data: { productionZoneStock: { decrement: qtyToConsume } }
                            });
                        }

                        console.log(`[completeNote] 🔄 Auto-consumed ${qtyToConsume}g of ${item.component?.name} from lot ${autoLot.lotNumber}`);
                    } else if (processCode === 'EMPAQUE' && item.componentId) {
                        // ── Packaging items without MaterialLot (tarros, tapas, etc.) ──
                        // Still decrement product stock for traceability
                        const qtyToConsume = Math.round(qty);
                        await tx.product.update({
                            where: { id: item.componentId },
                            data: { productionZoneStock: { decrement: qtyToConsume } }
                        });
                        console.log(`[completeNote] 📦 EMPAQUE stock-only consumed ${qtyToConsume} of ${item.component?.name} (no MaterialLot)`);
                    }
                }
            }

            // Process types that produce output — create MaterialLot + increment stock
            // PESAJE/COCCION do NOT produce output lots; only the final ENSAMBLE step does.
            const producesOutput = ['ENSAMBLE', 'FORMACION'].includes(note.processType?.code);
            let createdLotNumber = null; // will be used for RPA after tx commits
            console.log(`[completeNote] 📊 Stage: ${note.stageName} | processType: ${note.processType?.code} | producesOutput: ${producesOutput} | productId: ${note.productId || 'NULL'} | actualQty: ${actualQuantity}`);

            if (producesOutput && note.productId && actualQuantity > 0) {
                // Fabricated products stay in production zone
                await tx.product.update({
                    where: { id: note.productId },
                    data: {
                        productionZoneStock: { increment: actualQuantity }
                    }
                });

                // Generate a readable lot number: PRODUCT-PREFIX-YYMMDD-HHMM
                const now = new Date();
                const co = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
                const yy = String(co.getFullYear()).slice(-2);
                const mm = String(co.getMonth() + 1).padStart(2, '0');
                const dd = String(co.getDate()).padStart(2, '0');
                const hh = String(co.getHours()).padStart(2, '0');
                const mi = String(co.getMinutes()).padStart(2, '0');
                // Smart shortening: remove filler words (SABOR, A, X, GR, DE, PREMEZCLA)
                const rawName = (note.product?.name || '').toUpperCase();
                const shortName = rawName
                    .replace(/\bSABOR\b/g, '')
                    .replace(/\bPREMEZCLA\b/g, '')
                    .replace(/\bPERLAS\b/g, '')
                    .replace(/\s+A\s+/g, ' ')
                    .replace(/\s+X\s+/g, ' ')
                    .replace(/\s+DE\s+/g, ' ')
                    .replace(/\bGR\b/g, '')
                    .replace(/\bML\b/g, '')
                    .replace(/\bKG\b/g, '')
                    .trim()
                    .replace(/\s+/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/-$/, '');
                const lotNumber = `${shortName}-${yy}${mm}${dd}-${hh}${mi}`;

                const qty = Math.round(actualQuantity);
                await tx.materialLot.create({
                    data: {
                        productId: note.productId,
                        siigoProductCode: note.product?.sku || '',
                        siigoProductName: note.product?.name || '',
                        lotNumber,
                        initialQuantity: qty,
                        currentQuantity: qty,
                        unit: note.unit || note.product?.unit || 'unidad',
                        receivedAt: new Date(),
                        status: 'AVAILABLE',
                        zone: 'PRODUCTION'
                    }
                });
                createdLotNumber = lotNumber;
            }

            // ── Handle defective units from EMPAQUE (merma) ──
            // Frontend saves processParameters.empaque.defective_qty BEFORE calling complete
            const freshNote = await tx.assemblyNote.findUnique({ where: { id: noteId }, select: { processParameters: true } });
            const empaqueData = freshNote?.processParameters?.empaque;
            if (empaqueData?.defective_qty > 0 && note.productId) {
                const defQty = parseInt(empaqueData.defective_qty, 10);
                // Decrement product stock for defective units
                await tx.product.update({
                    where: { id: note.productId },
                    data: { currentStock: { decrement: defQty } }
                });
                // Log the defect
                await tx.auditLog.create({
                    data: {
                        userId: operatorId,
                        action: 'EMPAQUE_DEFECT_MERMA',
                        entity: 'AssemblyNote',
                        entityId: noteId,
                        changes: {
                            productId: note.productId,
                            productName: note.product?.name,
                            defective_qty: defQty,
                            approved_qty: empaqueData.approved_qty,
                            defect_reasons: empaqueData.defect_reasons || null
                        }
                    }
                });
                console.log(`📦 EMPAQUE merma: ${defQty} uds defectuosas de ${note.product?.name} descontadas del inventario`);
            }
            // Log audit
            await tx.auditLog.create({
                data: {
                    userId: operatorId,
                    action: 'ASSEMBLY_NOTE_COMPLETE',
                    entity: 'AssemblyNote',
                    entityId: noteId,
                    changes: {
                        targetQuantity: note.targetQuantity,
                        actualQuantity,
                        productId: note.productId,
                        productName: note.product?.name,
                        lotSelections: lotSelections || null
                    }
                }
            });

            // ── Auto-complete batch when all notes are done ──
            if (note.productionBatchId) {
                const pendingNotes = await tx.assemblyNote.count({
                    where: {
                        productionBatchId: note.productionBatchId,
                        status: { not: 'COMPLETED' },
                        id: { not: noteId }  // exclude current (already updated above)
                    }
                });
                if (pendingNotes === 0) {
                    await tx.productionBatch.update({
                        where: { id: note.productionBatchId },
                        data: {
                            status: 'COMPLETED',
                            completedAt: new Date()
                        }
                    });
                }
            }

            return { updatedNote, createdLotNumber, producesOutput, productName: note.product?.name, productSku: note.product?.sku, stageName: note.stageName };
        });

        // ── Fire RPA after transaction commits (fire-and-forget) ──
        if (result.producesOutput && result.createdLotNumber) {
            const productName = result.productName || '';
            const productSku = result.productSku || '';
            const stageName = result.stageName || '';
            const lotNum = result.createdLotNumber;
            const qty = actualQuantity;

            // Create RPA execution record + enqueue
            prisma.rpaExecution.create({
                data: {
                    executionType: 'SIIGO_ASSEMBLY',
                    status: 'RUNNING',
                    productName,
                    quantity: Math.round(Number(qty)),
                    assemblyType: 'proceso',
                    observations: `Proceso: ${stageName}. Lote: ${lotNum}.`,
                    assemblyNoteId: noteId,
                    triggeredById: operatorId || null
                }
            }).then(execution => {
                const startTime = Date.now();
                browserManager.enqueue({
                    params: {
                        productName: productSku || productName,
                        quantity: Math.round(Number(qty)),
                        assemblyType: 'proceso',
                        observations: `Proceso: ${stageName}. Lote: ${lotNum}.`
                    },
                    executionId: execution.id,
                    resolve: async (res) => {
                        await prisma.rpaExecution.update({
                            where: { id: execution.id },
                            data: {
                                status: res.success ? 'SUCCESS' : 'FAILED',
                                siigoNoteCode: res.siigoNoteCode || null,
                                siigoUrl: res.url || null,
                                screenshotPath: res.screenshotPath || null,
                                errorMessage: res.error || null,
                                logs: res.logs || [],
                                completedAt: new Date(),
                                durationMs: Date.now() - startTime
                            }
                        });
                        // Trigger immediate inventory sync after successful Siigo note creation
                        if (res.success) {
                            const siigoSvc = require('./siigoService');
                            siigoSvc.syncAllProducts().then(r => {
                                console.log(`📡 Post-RPA inventory sync: ${r.synced}/${r.total} products updated`);
                            }).catch(e => console.error('Post-RPA sync error:', e.message));
                        }
                    },
                    reject: async (err) => {
                        await prisma.rpaExecution.update({
                            where: { id: execution.id },
                            data: {
                                status: 'FAILED',
                                errorMessage: err.message,
                                screenshotPath: err.screenshotPath || null,
                                logs: err.logs || [],
                                completedAt: new Date(),
                                durationMs: Date.now() - startTime
                            }
                        });
                    }
                });
                console.log(`🤖 RPA enqueued for ${productName} — lot ${lotNum} (${Math.round(qty)} uds)`);
            }).catch(e => console.error('RPA enqueue error:', e.message));
        }

        return result.updatedNote;
    }
}

module.exports = new AssemblyService();
