const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const browserManager = require('./siigoBrowserManager');

// Strip accents for flavor-insensitive matching (CAFE ↔ CAFÉ)
const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Calculate REAL production zone stock from MaterialLot sums.
 * Auto-reconciles the productionZoneStock field if drift is detected.
 * This prevents false "Producción Bloqueada" due to accumulated rounding drift
 * from floor-to-zero consumption and tolerance adjustments.
 */
async function getProductionZoneStock(tx, productId) {
    const lots = await tx.materialLot.findMany({
        where: {
            productId,
            zone: 'PRODUCTION',
            currentQuantity: { gt: 0 },
            status: { in: ['AVAILABLE', 'LOW_STOCK'] }
        },
        select: { currentQuantity: true }
    });
    const realSum = lots.reduce((sum, l) => sum + l.currentQuantity, 0);

    // Auto-reconcile the cached field when drift > 1g
    const product = await tx.product.findUnique({
        where: { id: productId },
        select: { productionZoneStock: true }
    });
    const cached = product?.productionZoneStock || 0;
    if (Math.abs(cached - realSum) > 1) {
        console.log(`[zoneStock] 🔄 Auto-reconcile productId=${productId.slice(0,8)}: cached=${cached}g → real=${realSum}g (drift=${cached - realSum}g)`);
        await tx.product.update({
            where: { id: productId },
            data: { productionZoneStock: realSum }
        });
    }
    return realSum;
}

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

                    // ── Dynamic sub-template resolution by flavor ──
                    // The parent template may reference a default flavor's sub-template (e.g. MARACUYÁ).
                    // When the batch flavor differs, find the equivalent template for the correct flavor.
                    // This applies to COMPUESTO, SABORIZACIÓN, EMPAQUE (sirope presentations), etc.
                    if (batchFlavorForResolve && subTmpl.product?.name) {
                        const subProductName = subTmpl.product.name.toUpperCase();
                        const batchFlavorUpper = batchFlavorForResolve.toUpperCase();

                        // Check if the sub-template product contains a flavor that differs from batch flavor
                        // Known flavor keywords to detect mismatch
                        const KNOWN_FLAVORS = ['MARACUYA', 'FRESA', 'BLUEBERRY', 'MANGO BICHE', 'CEREZA', 'MANZANA VERDE', 'LYCHE', 'GRANADINA', 'CURAZAO', 'TAMARINDO', 'CHICLE', 'CHAMOY', 'ICE PINK', 'MORA', 'DURAZNO'];
                        const detectedFlavor = KNOWN_FLAVORS.find(f => subProductName.includes(f));

                        if (detectedFlavor && detectedFlavor !== batchFlavorUpper && !subProductName.includes(batchFlavorUpper)) {
                            // Build search pattern: replace the detected flavor with batch flavor
                            const searchName = subTmpl.product.name.replace(new RegExp(detectedFlavor, 'i'), batchFlavorForResolve);
                            const flavorTemplate = await prisma.assemblyTemplate.findFirst({
                                where: {
                                    isActive: true,
                                    product: { name: { equals: searchName, mode: 'insensitive' } }
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
                            if (flavorTemplate?.stages?.length > 0) {
                                console.log(`[generateNotes] 🔄 Resolved sub-template: ${subTmpl.templateCode} (${subTmpl.product.name}) → ${flavorTemplate.templateCode} (${flavorTemplate.product.name}) for flavor ${batchFlavorForResolve}`);
                                subTmpl = flavorTemplate;
                            } else {
                                // Fallback: try searching by templateName
                                const fallback = await prisma.assemblyTemplate.findFirst({
                                    where: {
                                        isActive: true,
                                        templateName: { contains: batchFlavorForResolve, mode: 'insensitive' },
                                        product: { name: { contains: subProductName.includes('1000') ? '1000' : subProductName.includes('360') ? '360' : batchFlavorForResolve, mode: 'insensitive' } }
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
                                if (fallback?.stages?.length > 0) {
                                    console.log(`[generateNotes] 🔄 Resolved sub-template (fallback): ${subTmpl.templateCode} → ${fallback.templateCode} for flavor ${batchFlavorForResolve}`);
                                    subTmpl = fallback;
                                } else {
                                    console.warn(`[generateNotes] ⚠️ No matching sub-template for "${searchName}" — using default ${subTmpl.templateCode}`);
                                }
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


            // ── Pre-flight: validate flavor-specific ingredients exist in catalogue ──
            // Runs BEFORE the transaction so any missing product aborts generation cleanly.
            if (batch.flavor) {
                const batchFlavorUp = batch.flavor.toUpperCase();
                const knownFlavorsCheck = ['MANGO BICHE CON SAL', 'MANGO BICHE', 'ICE PINK', 'FRESA', 'CHAMOY', 'CAFE', 'CAFÉ', 'LYCHE', 'LYCHEE', 'CHICLE', 'MARACUYA'];
                const flavorKeywordsCheck = ['ESFERAS', 'PROTECCION', 'ETIQUETA'];
                const missingProducts = [];

                for (const stage of flatStages) {
                    for (const input of (stage.inputs || [])) {
                        const inputName = (input.product?.name || '').toUpperCase();
                        const isFlavorSpecific = flavorKeywordsCheck.some(kw => inputName.includes(kw));
                        if (!isFlavorSpecific) continue;
                        // Already has the correct flavor → skip
                        if (stripAccents(inputName).includes(stripAccents(batchFlavorUp))) continue;

                        let found = false;
                        // Strategy 1: direct prefix (ESFERAS CHAMOY, PROTECCION CHAMOY)
                        const simplePrefix = ['ESFERAS', 'PROTECCION'].find(kw => inputName.startsWith(kw));
                        if (simplePrefix) {
                            const directName = `${simplePrefix} ${batch.flavor}`;
                            const p = await prisma.product.findFirst({
                                where: { name: { equals: directName, mode: 'insensitive' } },
                                select: { id: true }
                            });
                            if (p) found = true;
                        }
                        // Strategy 2: replace known flavor substring
                        if (!found) {
                            for (const flv of knownFlavorsCheck) {
                                if (stripAccents(inputName).includes(stripAccents(flv))) {
                                    const escaped = flv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                    const searchName = inputName.replace(new RegExp(escaped, 'i'), batch.flavor);
                                    const p = await prisma.product.findFirst({
                                        where: { name: { equals: searchName, mode: 'insensitive' } },
                                        select: { id: true }
                                    });
                                    if (p) found = true;
                                    break;
                                }
                            }
                        }
                        if (!found) {
                            missingProducts.push(`"${inputName}" → necesita "${batch.flavor}" (etapa: ${stage.stageName || '?'})`);
                        }
                    }
                }

                if (missingProducts.length > 0) {
                    throw new Error(
                        `⚠️ No se puede generar el lote con sabor "${batch.flavor}".\n` +
                        `Ingredientes sin equivalente "${batch.flavor}" en el catálogo:\n` +
                        missingProducts.map(m => `  • ${m}`).join('\n') +
                        `\n\nSolución: registre los productos faltantes en Catálogo antes de crear el lote.`
                    );
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

                    if ((isEmpaque || isEnsamble) && outputTargets.length > 0) {
                        // Match the stage to an outputTarget by product size in stageName
                        // Supports LIQUIPOPS (3400/1150/350) and GENIALITY (1000/360)
                        const SIZE_PATTERNS = ['3400', '1150', '1000', '360', '350'];
                        const matchedTarget = outputTargets.find(t => {
                            const pName = t.product?.name || '';
                            return SIZE_PATTERNS.some(size =>
                                stage.stageName?.includes(size) && pName.includes(size)
                            );
                        });

                        if (matchedTarget) {
                            targetQuantity = matchedTarget.plannedUnits || 1;
                            targetUnit = 'units';
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
                            // For ENSAMBLE steps matched to outputTargets: QPU is per-gram, so
                            // scale by targetQuantity (container count). For packaging items
                            // (TARRO/TAPA/FOIL/ETIQUETA), use container count directly.
                            // For other types: QPU is already the absolute quantity.
                            let plannedQuantity = input.quantityPerUnit;
                            if ((isEnsamble || isEmpaque) && targetUnit === 'units' && targetQuantity > 1) {
                                // Check if this is a packaging item (1:1 with containers)
                                const isPackaging = /(TARRO|TAPA|FOIL|ETIQUETA|SELLO|LINER|ENVASE)/i.test(input.product?.name || '');
                                plannedQuantity = isPackaging ? targetQuantity : input.quantityPerUnit * targetQuantity;
                            }

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
                                        const knownFlavors = ['MANGO BICHE CON SAL', 'MANGO BICHE', 'ICE PINK', 'FRESA', 'CHAMOY', 'CAFE', 'CAFÉ', 'LYCHE', 'LYCHEE', 'CHICLE', 'MARACUYA'];
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

            // ── POST-GENERATION GUARD: warn if EMPAQUE stages expected but none generated ──
            // LIQUIPOPS batches should always produce EMPAQUE notes. If the template has
            // EMPAQUE stages but none appear in generatedNotes, something went wrong silently.
            // This surfaces in pm2 logs for diagnosis before operators complete the batch.
            const empaqueStages = flatStages.filter(s => s.processType?.code === 'EMPAQUE');
            if (empaqueStages.length > 0 && generatedNotes.length > 0) {
                const hasAnyEmpaque = generatedNotes.some(n => {
                    return empaqueStages.some(es => es.id && es.id === n.stageId);
                });
                if (!hasAnyEmpaque) {
                    console.error(
                        `[generateNotes] ⚠️ CRITICAL — batch ${batchId} (${batch.batchNumber || 'unknown'}):\n`,
                        `Template has ${empaqueStages.length} EMPAQUE stage(s) but ZERO were generated.\n`,
                        `Generated ${generatedNotes.length} notes (stages: ${generatedNotes.map(n => n.stageOrder).join(',')}).\n`,
                        `Run fix_chamoy_empaque.js or regenerate EMPAQUE notes manually.`
                    );
                }
            }

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
                            select: { name: true, unit: true }
                        });
                        // AGUA is tap water — always available in zone, skip validation
                        if (product && product.name.toUpperCase() === 'AGUA') continue;
                        // Packaging materials (etiquetas, sellos, cajas) don't require zone transfer
                        const nameUpper = product?.name?.toUpperCase() || '';
                        if (nameUpper.includes('ETIQUETA') || nameUpper.includes('SELLO') || nameUpper.includes('CAJA')) continue;
                        // Use REAL lot sums instead of cached productionZoneStock
                        const realZoneStock = await getProductionZoneStock(tx, item.componentId);
                        if (product && realZoneStock < qty * 0.95) {
                            const unit = product.unit || 'und';
                            const fmtQty = (v) => unit === 'gramo' ? `${v.toLocaleString('es-CO')}g (${(v/1000).toFixed(1)}kg)` : `${v} ${unit}`;
                            shortages.push(
                                `${product.name}: necesita ${fmtQty(qty)}, zona tiene ${fmtQty(realZoneStock)}`
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
                        include: { items: { include: { component: { select: { name: true, unit: true } } } } }
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
                            // Use REAL lot sums instead of cached productionZoneStock
                            const zoneStock = await getProductionZoneStock(tx, item.componentId);
                            if (zoneStock < qty * 0.95) {
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

            // ── Normalize Geniality process codes to their base equivalents ──
            // G_ENSAMBLE → ENSAMBLE, G_EMPAQUE → EMPAQUE, G_PREMIX → PESAJE, etc.
            // This ensures all stock injection, consumption, and RPA logic works
            // identically for both classic and Geniality workflows.
            const normalizeCode = (code) => {
                if (!code) return code;
                if (code === 'G_ENSAMBLE') return 'ENSAMBLE';
                if (code === 'G_EMPAQUE') return 'EMPAQUE';
                return code;
            };
            // Patch processType.code on the in-memory note object
            if (note.processType) {
                note.processType = { ...note.processType, code: normalizeCode(note.processType.code) };
            }
            if (note.status === 'COMPLETED') {
                // Idempotent: already completed — return success instead of error
                // (handles double-tap on mobile/tablet)
                return { success: true, noteId, alreadyCompleted: true, status: 'COMPLETED' };
            }

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

            // ── CONTEO completion: sync actual counts → BatchOutputTarget ──
            // Downstream EMPAQUE/ENSAMBLE notes read META from outputTargets.plannedUnits.
            // After CONTEO, update plannedUnits so Ensamble Siigo shows the real count,
            // not the original scheduled estimate.
            if (note.processType?.code === 'CONTEO') {
                const conteoMap = note.processParameters?.conteo;
                if (conteoMap && typeof conteoMap === 'object') {
                    for (const [productName, data] of Object.entries(conteoMap)) {
                        if (data.productId && data.actual != null) {
                            const actualUnits = parseInt(data.actual, 10);
                            console.log(`[completeNote] CONTEO actual: ${productName} → ${actualUnits} units`);
                            // Update BatchOutputTarget: plannedUnits (for downstream Siigo META)
                            // AND actualUnits (Fase 5 relational field — fuente de verdad para reportes)
                            const updated = await tx.batchOutputTarget.updateMany({
                                where: {
                                    batchId: note.productionBatchId,
                                    productId: data.productId,
                                },
                                data: {
                                    plannedUnits: actualUnits,
                                    actualUnits: actualUnits,
                                },
                            });
                            // If no outputTarget existed (fully unplanned presentation), create one
                            if (updated.count === 0 && actualUnits > 0) {
                                console.log(`[completeNote] 🆕 Creating outputTarget for unplanned ${productName}`);
                                await tx.batchOutputTarget.create({
                                    data: {
                                        batchId: note.productionBatchId,
                                        productId: data.productId,
                                        plannedUnits: actualUnits,
                                        plannedWeightKg: 0,
                                        actualUnits: actualUnits,
                                    }
                                });
                            }
                        }
                    }
                }
            }

            // ── CONTEO → Dynamic EMPAQUE/ENSAMBLE note generation ──
            // When operator adds unplanned presentations (e.g. 3400g from leftover mix),
            // auto-generate the missing EMPAQUE + ENSAMBLE notes so the full packaging
            // and Siigo workflow can execute for those extra items.
            if (note.processType?.code === 'CONTEO') {
                try {
                    const conteoMap = note.processParameters?.conteo;
                    if (conteoMap && typeof conteoMap === 'object') {
                        // Get all existing EMPAQUE/ENSAMBLE notes for this batch
                        const existingNotes = await tx.assemblyNote.findMany({
                            where: {
                                productionBatchId: note.productionBatchId,
                                processType: { code: { in: ['EMPAQUE', 'ENSAMBLE'] } }
                            },
                            select: { stageName: true, processType: { select: { code: true } }, processParameters: true }
                        });

                        // Identify which sizes already have notes
                        const SIZE_PATTERNS = ['3400', '1150', '1000', '360', '350'];
                        const coveredSizes = { EMPAQUE: new Set(), ENSAMBLE: new Set() };
                        for (const en of existingNotes) {
                            for (const size of SIZE_PATTERNS) {
                                if (en.stageName?.includes(size)) {
                                    coveredSizes[en.processType?.code]?.add(size);
                                }
                            }
                        }

                        // Find presentations with actual > 0 that are MISSING notes
                        const missingSizes = [];
                        for (const [productName, data] of Object.entries(conteoMap)) {
                            const actual = parseInt(data.actual, 10) || 0;
                            if (actual <= 0) continue;
                            const matchedSize = SIZE_PATTERNS.find(s => productName.includes(s));
                            if (matchedSize && !coveredSizes.EMPAQUE.has(matchedSize)) {
                                missingSizes.push({ size: matchedSize, productId: data.productId, productName, actual });
                            }
                        }

                        if (missingSizes.length > 0) {
                            console.log(`[completeNote] 🆕 CONTEO detected ${missingSizes.length} unplanned presentation(s): ${missingSizes.map(m => m.productName).join(', ')}`);

                            // Load batch template with EMPAQUE/ENSAMBLE stages + inputs
                            const batchTemplate = await tx.assemblyTemplate.findUnique({
                                where: { id: note.templateId },
                                include: {
                                    stages: {
                                        where: { processType: { code: { in: ['EMPAQUE', 'ENSAMBLE'] } } },
                                        include: {
                                            processType: true,
                                            inputs: { include: { product: true }, orderBy: { displayOrder: 'asc' } },
                                            outputProduct: true
                                        },
                                        orderBy: { stageOrder: 'asc' }
                                    }
                                }
                            });

                            // Get max stageOrder for appending
                            const maxOrder = await tx.assemblyNote.aggregate({
                                where: { productionBatchId: note.productionBatchId },
                                _max: { stageOrder: true }
                            });
                            let nextOrder = (maxOrder._max.stageOrder || 0);

                            const batchFlavor = (note.productionBatch?.flavor || '').toUpperCase();
                            const batchNumber = note.productionBatch?.batchNumber || '';

                            for (const missing of missingSizes) {
                                // Find the template stages that match this size (EMPAQUE + ENSAMBLE)
                                for (const processCode of ['EMPAQUE', 'ENSAMBLE']) {
                                    const templateStage = batchTemplate?.stages?.find(s =>
                                        s.processType?.code === processCode && s.stageName?.includes(missing.size)
                                    );
                                    if (!templateStage) {
                                        console.warn(`[completeNote] ⚠️ No ${processCode} template stage for size ${missing.size}`);
                                        continue;
                                    }

                                    nextOrder++;
                                    const ts = Date.now().toString().slice(-8);
                                    const noteNumber = `ANTE-${batchNumber.replace(/^B-\d+-/, '').replace(/-/g, '')}-${ts}-S${nextOrder}`;

                                    // Resolve stageName: replace {SABOR} with batch flavor
                                    const resolvedStageName = templateStage.stageName
                                        ?.replace('{SABOR}', batchFlavor)
                                        ?.replace('{sabor}', batchFlavor) || templateStage.stageName;

                                    const processTypeId = templateStage.processTypeId;

                                    const newNote = await tx.assemblyNote.create({
                                        data: {
                                            noteNumber,
                                            productId: missing.productId,
                                            productionBatchId: note.productionBatchId,
                                            templateId: note.templateId,
                                            stageId: templateStage.id,
                                            stageOrder: nextOrder,
                                            stageName: resolvedStageName,
                                            targetQuantity: missing.actual,
                                            unit: 'units',
                                            status: 'PENDING',
                                            processTypeId,
                                            processParameters: {
                                                product_id: missing.productId,
                                                _dynamicFromConteo: true
                                            }
                                        }
                                    });

                                    // Create note items (inputs) with flavor resolution
                                    if (templateStage.inputs?.length > 0) {
                                        for (const input of templateStage.inputs) {
                                            const isPackaging = /(TARRO|TAPA|FOIL|ETIQUETA|SELLO|LINER|ENVASE)/i.test(input.product?.name || '');
                                            const plannedQuantity = isPackaging
                                                ? missing.actual
                                                : input.quantityPerUnit * missing.actual;

                                            // Flavor resolution (same logic as generateNotesForBatch)
                                            let resolvedComponentId = input.productId;
                                            const inputName = (input.product?.name || '').toUpperCase();
                                            const flavorKeywords = ['ESFERAS', 'PROTECCION', 'ETIQUETA'];
                                            const isFlavorSpecific = flavorKeywords.some(kw => inputName.includes(kw));

                                            if (batchFlavor && isFlavorSpecific) {
                                                const inputFlavorNorm = stripAccents(inputName);
                                                const batchFlavorNorm = stripAccents(batchFlavor);

                                                if (!inputFlavorNorm.includes(batchFlavorNorm)) {
                                                    let flavorProduct = null;
                                                    const simplePrefix = ['ESFERAS', 'PROTECCION'].find(kw => inputName.startsWith(kw));
                                                    if (simplePrefix) {
                                                        flavorProduct = await tx.product.findFirst({
                                                            where: { name: { equals: `${simplePrefix} ${batchFlavor}`, mode: 'insensitive' } },
                                                            select: { id: true, name: true }
                                                        });
                                                    }
                                                    if (!flavorProduct) {
                                                        const knownFlavors = ['MANGO BICHE CON SAL', 'MANGO BICHE', 'ICE PINK', 'FRESA', 'CHAMOY', 'CAFE', 'CAFÉ', 'LYCHE', 'LYCHEE', 'CHICLE', 'MARACUYA', 'SANDIA'];
                                                        let searchName = inputName;
                                                        for (const flv of knownFlavors) {
                                                            if (stripAccents(inputName).includes(stripAccents(flv))) {
                                                                searchName = inputName.replace(new RegExp(flv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), batchFlavor);
                                                                break;
                                                            }
                                                        }
                                                        flavorProduct = await tx.product.findFirst({
                                                            where: { name: { equals: searchName, mode: 'insensitive' } },
                                                            select: { id: true, name: true }
                                                        });
                                                    }
                                                    if (flavorProduct) {
                                                        console.log(`[completeNote] 🔄 DynNote flavor swap: ${inputName} → ${flavorProduct.name}`);
                                                        resolvedComponentId = flavorProduct.id;
                                                    }
                                                }
                                            }

                                            await tx.assemblyNoteItem.create({
                                                data: {
                                                    assemblyNoteId: newNote.id,
                                                    componentId: resolvedComponentId,
                                                    componentType: input.inputType || 'RAW_MATERIAL',
                                                    plannedQuantity,
                                                    unit: input.unit
                                                }
                                            });
                                        }
                                    }

                                    console.log(`[completeNote] ✅ Created dynamic ${processCode} note: ${resolvedStageName} (${missing.actual} units) → S${nextOrder}`);
                                }
                            }
                        }
                    }
                } catch (dynErr) {
                    // Don't fail CONTEO completion if dynamic note generation fails
                    console.error(`[completeNote] ❌ Dynamic EMPAQUE/ENSAMBLE generation failed (non-blocking):`, dynErr.message);
                }
            }

            // ── ZONE STOCK VALIDATION — block if insufficient production zone stock ──
            const processCode = normalizeCode(note.processType?.code); // already normalized but keep for clarity
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
                            select: { name: true, unit: true }
                        });
                        // AGUA is tap water — always available in zone, skip validation
                        if (product && product.name.toUpperCase() === 'AGUA') continue;
                        // Packaging materials (etiquetas, sellos, cajas) don't require zone transfer
                        const nameUpper2 = product?.name?.toUpperCase() || '';
                        if (nameUpper2.includes('ETIQUETA') || nameUpper2.includes('SELLO') || nameUpper2.includes('CAJA')) continue;
                        // Use REAL lot sums instead of cached productionZoneStock
                        const realZoneStock = await getProductionZoneStock(tx, item.componentId);
                        if (product && realZoneStock < qty * 0.95) {
                            const unit = product.unit || 'und';
                            const fmtQty = (v) => unit === 'gramo' ? `${v.toLocaleString('es-CO')}g (${(v/1000).toFixed(1)}kg)` : `${v} ${unit}`;
                            shortages.push(
                                `${product.name}: necesita ${fmtQty(qty)}, zona tiene ${fmtQty(realZoneStock)}`
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
            // GUARD: Skip if Post-CONTEO already pre-consumed these items.
            // When CONTEO completes (assemblyNoteController.completeNote), it auto-consumes
            // ALL EMPAQUE materials and flags materialsPreConsumed=true. If the frontend
            // then sends lotSelections when completing EMPAQUE, we must NOT consume again.
            const alreadyPreConsumedLots = note.processParameters?.materialsPreConsumed === true;

            if (lotSelections && typeof lotSelections === 'object' && !alreadyPreConsumedLots) {
                for (const [itemId, lotId] of Object.entries(lotSelections)) {
                    if (!lotId) continue;

                    const item = (note.items || []).find(i => i.id === itemId);
                    // Use actualQuantity if recorded; fall back to plannedQuantity if operator
                    // didn't register actual weight (prevents ingredients from being silently skipped)
                    const consumeQty = item?.actualQuantity || item?.plannedQuantity || 0;
                    if (!item || consumeQty <= 0) continue;

                    let remaining = Math.round(consumeQty);

                    // ── MULTI-LOT CASCADING CONSUMPTION ──
                    // Start with the selected lot, then cascade to other PRODUCTION lots
                    // if the selected one doesn't have enough balance.
                    const selectedLot = await tx.materialLot.findUnique({ where: { id: lotId } });
                    if (!selectedLot) {
                        console.warn(`[completeNote] Lot ${lotId} not found, skipping`);
                        continue;
                    }

                    // Build ordered list: selected lot first, then others by receivedAt desc
                    const otherLots = await tx.materialLot.findMany({
                        where: {
                            productId: item.componentId,
                            zone: 'PRODUCTION',
                            currentQuantity: { gt: 0 },
                            status: { in: ['AVAILABLE', 'LOW_STOCK'] },
                            id: { not: lotId }
                        },
                        orderBy: { receivedAt: 'asc' }
                    });
                    const lotsToConsume = [selectedLot, ...otherLots];

                    for (const lot of lotsToConsume) {
                        if (remaining <= 0) break;
                        if (lot.currentQuantity <= 0) continue;

                        const consumeFromLot = Math.min(remaining, lot.currentQuantity);
                        const newQty = lot.currentQuantity - consumeFromLot;

                        await tx.materialLot.update({
                            where: { id: lot.id },
                            data: {
                                currentQuantity: Math.max(0, newQty),
                                status: newQty <= 0 ? 'DEPLETED'
                                    : newQty < (lot.initialQuantity * 0.1) ? 'LOW_STOCK'
                                        : 'AVAILABLE'
                            }
                        });

                        await tx.lotConsumption.create({
                            data: {
                                materialLotId: lot.id,
                                assemblyNoteId: noteId,
                                quantityUsed: consumeFromLot,
                                usedById: operatorId,
                                observations: `${note.stageName || 'Producción'} — ${item.component?.name || 'Material'}${lotsToConsume.length > 1 ? ' (multi-lote)' : ''}`
                            }
                        });

                        remaining -= consumeFromLot;
                        console.log(`[completeNote] 📦 Consumed ${consumeFromLot}g from lot ${lot.lotNumber} (remaining: ${remaining}g)`);
                    }

                    if (remaining > 0 && processCode === 'PESAJE') {
                        // Allow small tolerance (< 1%)
                        const totalNeeded = Math.round(item.actualQuantity);
                        const tolerancePct = totalNeeded > 0 ? (remaining / totalNeeded) : 1;
                        if (tolerancePct > 0.01) {
                            const componentName = item.component?.name || 'Material';
                            throw new Error(
                                `⛔ No hay suficiente saldo en lotes de zona PRODUCCIÓN para ${componentName}.\n` +
                                `Necesita: ${(totalNeeded/1000).toFixed(1)} kg | Faltante: ${(remaining/1000).toFixed(1)} kg\n\n` +
                                `Transfiera más material desde Bodega a Zona de Producción antes de continuar.`
                            );
                        }
                    }

                    // Decrement production zone stock (floor-to-zero: prevent negative)
                    const totalConsumed = Math.round(item.actualQuantity) - Math.max(0, remaining);
                    const curProd = await tx.product.findUnique({
                        where: { id: item.componentId },
                        select: { productionZoneStock: true }
                    });
                    const curZone = curProd?.productionZoneStock || 0;
                    const safeDec = Math.min(totalConsumed, Math.max(0, curZone));
                    if (safeDec > 0) {
                        await tx.product.update({
                            where: { id: item.componentId },
                            data: { productionZoneStock: { decrement: safeDec } }
                        });
                    }
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

                    // ── MULTI-LOT CASCADING AUTO-CONSUMPTION ──
                    // Find ALL available lots in PRODUCTION zone, consume across them
                    const availableLots = await tx.materialLot.findMany({
                        where: {
                            productId: item.componentId,
                            currentQuantity: { gt: 0 },
                            status: { in: ['AVAILABLE', 'LOW_STOCK'] },
                            zone: 'PRODUCTION'
                        },
                        orderBy: { receivedAt: 'asc' }
                    });

                    if (availableLots.length > 0) {
                        let remaining = Math.round(qty);

                        for (const lot of availableLots) {
                            if (remaining <= 0) break;
                            if (lot.currentQuantity <= 0) continue;

                            const consumeFromLot = Math.min(remaining, lot.currentQuantity);
                            const newQty = lot.currentQuantity - consumeFromLot;

                            await tx.materialLot.update({
                                where: { id: lot.id },
                                data: {
                                    currentQuantity: Math.max(0, newQty),
                                    status: newQty <= 0 ? 'DEPLETED'
                                        : newQty < (lot.initialQuantity * 0.1) ? 'LOW_STOCK'
                                            : 'AVAILABLE'
                                }
                            });

                            await tx.lotConsumption.create({
                                data: {
                                    materialLotId: lot.id,
                                    assemblyNoteId: noteId,
                                    quantityUsed: consumeFromLot,
                                    usedById: operatorId,
                                    observations: `${note.stageName || 'Producción'} — ${item.component?.name || 'Material'} (auto${availableLots.length > 1 ? ', multi-lote' : ''})`
                                }
                            });

                            remaining -= consumeFromLot;
                            console.log(`[completeNote] 🔄 Auto-consumed ${consumeFromLot}g of ${item.component?.name} from lot ${lot.lotNumber} (remaining: ${remaining}g)`);
                        }

                        if (remaining > 0 && processCode === 'PESAJE') {
                            const totalNeeded = Math.round(qty);
                            const tolerancePct = totalNeeded > 0 ? (remaining / totalNeeded) : 1;
                            if (tolerancePct > 0.01) {
                                const componentName = item.component?.name || 'Material';
                                throw new Error(
                                    `⛔ No hay suficiente saldo en lotes de zona PRODUCCIÓN para ${componentName}.\n` +
                                    `Necesita: ${(totalNeeded/1000).toFixed(1)} kg | Faltante: ${(remaining/1000).toFixed(1)} kg\n\n` +
                                    `Transfiera más material desde Bodega a Zona de Producción antes de continuar.`
                                );
                            }
                        }

                        // Decrement production zone stock
                        const totalConsumed = Math.round(qty) - Math.max(0, remaining);
                        if (item.componentId && totalConsumed > 0) {
                            const currentProduct = await tx.product.findUnique({
                                where: { id: item.componentId },
                                select: { productionZoneStock: true }
                            });
                            const currentZoneStock = currentProduct?.productionZoneStock || 0;
                            const safeDecrement = Math.min(totalConsumed, Math.max(0, currentZoneStock));
                            if (safeDecrement > 0) {
                                await tx.product.update({
                                    where: { id: item.componentId },
                                    data: { productionZoneStock: { decrement: safeDecrement } }
                                });
                            }
                        }
                    } else if (processCode === 'EMPAQUE' && item.componentId) {
                        // ── Packaging items without MaterialLot (tarros, tapas, etc.) ──
                        // Try to consume from zone first. If not enough, pull from main Bodega stock.
                        const qtyToConsume = Math.round(qty);
                        const currentProduct = await tx.product.findUnique({
                            where: { id: item.componentId },
                            select: { productionZoneStock: true, currentStock: true }
                        });
                        const currentZoneStock = currentProduct?.productionZoneStock || 0;
                        const currentBodegaStock = currentProduct?.currentStock || 0;
                        const consumeFromZone = Math.min(qtyToConsume, Math.max(0, currentZoneStock));
                        // Floor-to-zero: never pull more from bodega than available
                        const consumeFromBodega = Math.min(qtyToConsume - consumeFromZone, Math.max(0, currentBodegaStock));

                        if (consumeFromZone > 0) {
                            await tx.product.update({
                                where: { id: item.componentId },
                                data: { productionZoneStock: { decrement: consumeFromZone } }
                            });
                        }
                        if (consumeFromBodega > 0) {
                            await tx.product.update({
                                where: { id: item.componentId },
                                data: { currentStock: { decrement: consumeFromBodega } }
                            });
                        }

                        // Mark item as consumed directly so we don't trigger false alerts
                        await tx.assemblyNoteItem.update({
                            where: { id: item.id },
                            data: {
                                actualQuantity: qtyToConsume,
                                consumed: true,
                                consumedAt: new Date(),
                                consumedById: operatorId
                            }
                        });
                        console.log(`[completeNote] 📦 EMPAQUE stock-only consumed ${qtyToConsume} of ${item.component?.name} (Zone: ${consumeFromZone}, Bodega: ${consumeFromBodega})`);
                    }
                }
            }

            // ── POST-CONSUMPTION VERIFICATION ──
            // After all consumption, verify items were actually decremented.
            let consumptionAlerts = [];
            if (canAutoConsume && (note.items || []).length > 0) {
                for (const item of note.items) {
                    if (!item.componentId) continue;
                    const expectedQty = item.actualQuantity || item.plannedQuantity || 0;
                    if (expectedQty <= 0) continue;
                    const componentName = item.component?.name || 'Material';
                    if (componentName.toUpperCase() === 'AGUA') continue;

                    // Check if lotConsumption records were created for this note + component
                    const consumptions = await tx.lotConsumption.findMany({
                        where: { assemblyNoteId: noteId, materialLot: { productId: item.componentId } },
                        select: { quantityUsed: true }
                    });
                    const totalConsumed = consumptions.reduce((s, c) => s + c.quantityUsed, 0);

                    if (totalConsumed <= 0 && expectedQty > 0) {
                        const updatedItem = await tx.assemblyNoteItem.findUnique({ where: { id: item.id }, select: { consumed: true, actualQuantity: true } });
                        if (updatedItem?.consumed && updatedItem?.actualQuantity > 0) {
                            continue; // Successfully consumed via stock decrement (no lot)
                        }
                        consumptionAlerts.push({ component: componentName, expected: expectedQty, consumed: 0, issue: 'NO_CONSUMPTION' });
                    } else if (totalConsumed < expectedQty * 0.9 && expectedQty > 1) {
                        consumptionAlerts.push({ component: componentName, expected: expectedQty, consumed: totalConsumed, issue: 'PARTIAL_CONSUMPTION' });
                    }
                }
                if (consumptionAlerts.length > 0) {
                    const alertMsg = consumptionAlerts.map(a =>
                        `⚠️ ${a.component}: esperado ${a.expected}, consumido ${a.consumed} [${a.issue}]`
                    ).join('\n');
                    console.error(`\n🚨 [CONSUMPTION ALERT] ${note.stageName} (${noteId}):\n${alertMsg}\n`);
                    await tx.auditLog.create({
                        data: {
                            userId: operatorId,
                            action: 'CONSUMPTION_ALERT',
                            entity: 'AssemblyNote',
                            entityId: noteId,
                            changes: { stageName: note.stageName, processType: processCode, alerts: consumptionAlerts }
                        }
                    });
                }
            }

            // ── DECOUPLED STOCK INJECTION (App-First, Siigo-Second) ──
            // Stock injection happens at the PENULTIMATE step (the one right before
            // the final ENSAMBLE Siigo step), NOT at ENSAMBLE completion.
            // This decouples production from Siigo: if Siigo RPA fails, the
            // production zone stock is already correct and downstream processes
            // continue unblocked. The ENSAMBLE step only fires RPA (accounting).
            let producesOutput = false;
            let createdLotNumber = null;

            if (processCode === 'ENSAMBLE') {
                // ENSAMBLE / G_ENSAMBLE step: INJECTS stock with the correct scaled actualQuantity.
                // The actualQuantity here reflects the real formula output (e.g. 122,327g)
                // which is more accurate than the Pesaje target (e.g. 120,347g).
                producesOutput = true;
                createdLotNumber = note.productionBatch?.batchNumber || null;
                console.log(`[completeNote] 📊 ENSAMBLE step — WILL inject stock + fire RPA. lotNumber: ${createdLotNumber} | qty: ${actualQuantity}`);
            } else if (processCode === 'FORMACION') {
                // FORMACION (esferas) produces output directly — no ENSAMBLE follows it
                producesOutput = true;
                console.log(`[completeNote] 📊 FORMACION step — WILL inject stock. Stage: ${note.stageName} | qty: ${actualQuantity}`);
            } else if (note.productionBatchId && note.productId) {
                // For any other step: check if the NEXT step (by stageOrder) for the
                // SAME productId is an ENSAMBLE. If so, this step does NOT inject
                // (the ENSAMBLE will handle it with the correct quantity).
                const batchNotes = await tx.assemblyNote.findMany({
                    where: { productionBatchId: note.productionBatchId },
                    select: { id: true, stageOrder: true, productId: true, processType: { select: { code: true } } },
                    orderBy: { stageOrder: 'asc' }
                });

                // Find the current note's index
                const myIdx = batchNotes.findIndex(n => n.id === noteId);
                let nextEnsambleForProduct = false;

                if (myIdx >= 0) {
                    // Look for the next step with same productId
                    for (let i = myIdx + 1; i < batchNotes.length; i++) {
                        if (batchNotes[i].productId === note.productId) {
                            // Found next step for same product — is it ENSAMBLE or G_ENSAMBLE?
                            const nextCode = normalizeCode(batchNotes[i].processType?.code);
                            nextEnsambleForProduct = nextCode === 'ENSAMBLE';
                            break; // only check the immediately next one for this product
                        }
                    }
                }

                if (nextEnsambleForProduct) {
                    // PRE-ENSAMBLE: do NOT inject stock here — the ENSAMBLE step will
                    // inject with the correct scaled quantity.
                    producesOutput = false;
                    console.log(`[completeNote] 📊 PRE-ENSAMBLE step — skipping stock injection (deferred to ENSAMBLE). Stage: ${note.stageName} | product: ${note.product?.name}`);
                } else {
                    // Even if this is an intermediate step like EMPAQUE without a following ENSAMBLE,
                    // we don't inject stock here (e.g. Geniality uses finishedLotService for carriots).
                    console.log(`[completeNote] 📊 Intermediate/Final EMPAQUE step — no stock injection (handled by carriots). Stage: ${note.stageName} | order: ${note.stageOrder}`);
                }
            }

            console.log(`[completeNote] 📊 Stage: ${note.stageName} | processType: ${note.processType?.code} | producesOutput: ${producesOutput} | productId: ${note.productId || 'NULL'} | actualQty: ${actualQuantity}`);

            if (producesOutput && note.productId && actualQuantity > 0) {
                // Fabricated products stay in production zone
                await tx.product.update({
                    where: { id: note.productId },
                    data: {
                        productionZoneStock: { increment: actualQuantity }
                    }
                });

                // Use the batch's own batchNumber as the traceability lot number.
                // This is the number stamped on the physical containers (tarros, cajas)
                // and must remain consistent across the entire batch lifecycle.
                const lotNumber = note.productionBatch?.batchNumber || `${note.productId?.slice(-6)}-${Date.now()}`;

                const qty = Math.round(actualQuantity);

                // ── SKIP materialLot for finished products (accountGroup 1401/1402) ──
                // Finished products (LIQUIPOPS, SIROPES, LIQUIMON) are tracked exclusively
                // in finished_lot_stock via the operator ingestion flow.
                // Only intermediate materials (bases, compuestos, protecciones) need a materialLot
                // so they can be consumed by downstream assembly stages.
                const isFinishedProduct = [1401, 1402].includes(note.product?.accountGroup) && note.product?.type !== 'MATERIA_PRIMA';
                if (!isFinishedProduct) {
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
                    console.log(`[completeNote] ✅ MaterialLot created for ${note.product?.name} — lot: ${lotNumber} (${qty} uds)`);
                } else {
                    // ── FINISHED PRODUCTS: stock ingestion handled by EMPAQUE wizard ──
                    // Finished products (LIQUIPOPS, SIROPES, etc.) are tracked in
                    // FinishedLotStock via the operator's empaque/rotulado flow which
                    // calls finishedLotService.ingestFromProduction(). We do NOT
                    // auto-ingest here to avoid double-counting.
                    console.log(`[completeNote] ℹ️ Finished product ${note.product?.name} — stock ingestion deferred to EMPAQUE wizard (lot: ${lotNumber}, ${qty} uds)`);
                }
                createdLotNumber = lotNumber;
            } // end if (producesOutput)

            // ── Handle defective units from EMPAQUE (merma) ──
            // Frontend saves processParameters.empaque.defective_qty BEFORE calling complete
            const freshNote = await tx.assemblyNote.findUnique({ where: { id: noteId }, select: { processParameters: true } });
            const empaqueData = freshNote?.processParameters?.empaque;

            // ── FASE 5: Escribir approved_units / defective_units al BatchOutputTarget ──
            // Esto normaliza los datos del JSON a columnas relacionales para reportes.
            // El target se identifica por batchId + productId de la nota EMPAQUE.
            if (empaqueData && note.productionBatchId && note.productId) {
                const approvedQty  = parseInt(empaqueData.approved_qty  || 0, 10);
                const defectiveQty = parseInt(empaqueData.defective_qty || 0, 10);
                const targetProductId = note.processParameters?.product_id || note.productId;
                await tx.batchOutputTarget.updateMany({
                    where: { batchId: note.productionBatchId, productId: targetProductId },
                    data: {
                        approvedUnits:  approvedQty,
                        defectiveUnits: defectiveQty,
                    },
                }).catch(e => console.warn('[completeNote] ⚠️ Could not update approvedUnits on outputTarget:', e.message));
                console.log(`[completeNote] 📊 EMPAQUE output recorded: approved=${approvedQty} defective=${defectiveQty} → product ${targetProductId}`);
            }

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

            const isEnsambleStep = ['ENSAMBLE', 'FORMACION'].includes(processCode);
            return { updatedNote, createdLotNumber, producesOutput, isEnsambleStep, productName: note.product?.name, productSku: note.product?.sku, stageName: note.stageName, batchNumber: note.productionBatch?.batchNumber || null, targetQuantity: note.targetQuantity, consumptionAlerts: consumptionAlerts.length > 0 ? consumptionAlerts : undefined };
        });

        // ── Fire RPA after transaction commits (fire-and-forget) ──
        // RPA fires when completing an ENSAMBLE step (Siigo accounting)
        // regardless of stock injection (which now happens at penultimate step)
        if (result.isEnsambleStep && result.createdLotNumber) {
            const productName = result.productName || '';
            const productSku = result.productSku || '';
            const stageName = result.stageName || '';
            const lotNum = result.createdLotNumber;
            const batchNum = result.batchNumber || '';
            const qty = result.targetQuantity || actualQuantity; // Use targetQuantity (App-first), fallback to actualQuantity

            // ── GENIALITY DUPLICATE-RPA GUARD ──────────────────────────────────────────
            // For Geniality products, the RPA already fires per-carrito during the
            // MarcadoCajas/Empaque flow (observations contain "Parcial").
            // If those per-carrito RPAs succeeded, we must NOT fire another ENSAMBLE
            // RPA or it will double-register the assembly in Siigo accounting.
            let skipRpa = false;
            try {
                // ── EXPLICIT skipRpa FLAG (set by frontend auto-skip for "Ensamble Siigo" notes) ──
                // Per-carrito RPAs already handled Siigo accounting during MARCADO_CAJAS.
                const freshNoteParams = await prisma.assemblyNote.findUnique({
                    where: { id: noteId }, select: { processParameters: true }
                });
                if (freshNoteParams?.processParameters?.skipRpa) {
                    console.log(`[completeNote] ⏭️ RPA SKIPPED — skipRpa flag set on note ${noteId} (per-carrito RPAs already handled Siigo)`);
                    skipRpa = true;
                }
            } catch (e) { /* continue to other guards */ }
            try {
                // ── GLOBAL RPA DUPLICATE LOCK ────────────────────────────────────────────────
                // Prevents multiple concurrent clicks/HTTP requests from queueing duplicate RPAs
                const duplicateLock = await prisma.rpaExecution.findFirst({
                    where: { assemblyNoteId: noteId, status: { in: ['PENDING', 'RUNNING', 'SUCCESS'] } }
                });
                if (duplicateLock) {
                    console.log(`[completeNote] ⏭️ RPA LOCKED — Execution already exists for note ${noteId}. Preventing duplicates.`);
                    skipRpa = true;
                }

                if (!skipRpa) {
                    // ── GENIALITY PER-CARRITO DUPLICATE GUARD ──
                    const existingPerCarritoRpa = await prisma.rpaExecution.findFirst({
                        where: {
                            status: 'SUCCESS',
                            observations: { contains: `Lote: ${batchNum}` },
                            productName: { contains: productName.slice(0, 20) }
                        }
                    });
                    if (existingPerCarritoRpa) {
                        console.log(`[completeNote] ⏭️ ENSAMBLE RPA SKIPPED — per-carrito RPAs already SUCCESS for ${productName} (lote ${batchNum}). Avoiding Siigo duplicate.`);
                        skipRpa = true;
                    }
                }
            } catch (guardErr) {
                console.warn('[completeNote] ⚠️ Could not check RPA guard locks:', guardErr.message);
            }

            if (!skipRpa) {
            prisma.rpaExecution.create({
                data: {
                    executionType: 'SIIGO_ASSEMBLY',
                    status: 'RUNNING',
                    productName,
                    quantity: Math.round(Number(qty)),
                    assemblyType: 'proceso',
                    observations: `Lote: ${batchNum}. Proceso: ${stageName}. Lote Material: ${lotNum}.`,
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
                        observations: `Lote: ${batchNum}. Proceso: ${stageName}. Lote Material: ${lotNum}.`
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
            } // end if (!skipRpa)
        }

        return result;
    }
}

module.exports = new AssemblyService();
