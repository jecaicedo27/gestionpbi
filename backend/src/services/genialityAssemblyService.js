const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const browserManager = require('./siigoBrowserManager');
const finishedLotService = require('./finishedLotService');

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
                        const KNOWN_FLAVORS = ['MARACUYA', 'FRESA', 'BLUEBERRY', 'MANGO BICHE', 'CEREZA', 'MANZANA VERDE', 'LYCHE', 'GRANADINA', 'CURAZAO', 'TAMARINDO', 'CHICLE', 'CHAMOY', 'ICE PINK', 'MORA', 'DURAZNO', 'ESCARCHADOR'];
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
                const knownFlavorsCheck = ['MANGO BICHE CON SAL', 'MANGO BICHE', 'ICE PINK', 'FRESA', 'CHAMOY', 'CAFE', 'CAFÉ', 'LYCHE', 'LYCHEE', 'CHICLE', 'MARACUYA', 'MORA', 'DURAZNO', 'ESCARCHADOR'];
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
            
            // For Geniality, templates are always scaled to a 100kg standard base.
            // When baseWeight is specified (e.g. 75kg), we scale all raw materials.
            const baseStandardKg = 100.0;
            const scaleFactor = (batch.baseWeight && batch.baseWeight > 0) ? (batch.baseWeight / baseStandardKg) : 1.0;

            await prisma.$transaction(async (tx) => {
                for (const stage of flatStages) {
                    globalStageOrder++;
                    // Generate a unique note number using timestamp to avoid collisions
                    const ts = Date.now().toString().slice(-8); // Last 8 digits of timestamp
                    const noteNumber = `ANTE-${batch.batchNumber.replace(/^B-\d+-/, '').replace(/-/g, '')}-${ts}-S${globalStageOrder}`;

                    // targetQuantity: for PESAJE stages with a sub-template product, use the formula quantity
                    const isPesaje = stage.processType?.code === 'PESAJE';
                    const isEnsamble = ['ENSAMBLE', 'G_ENSAMBLE', 'E_ENSAMBLE'].includes(stage.processType?.code);
                    const isConteo = ['CONTEO', 'G_CONTEO'].includes(stage.processType?.code);
                    const isEmpaque = ['EMPAQUE', 'G_EMPAQUE'].includes(stage.processType?.code);
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
                            targetQuantity = (stageFormula.baseQuantity || 1) * scaleFactor;
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
                            targetQuantity = (formula.baseQuantity || 1) * scaleFactor;
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
                            targetQuantity = (formacionFormula.baseQuantity || 150000) * scaleFactor;
                            targetUnit = formacionFormula.baseUnit || 'g';
                        } else {
                            targetQuantity = 150000 * scaleFactor;
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
                        } else {
                            // If there is NO target for this size, skip it entirely!
                            noteStatus = 'COMPLETED';
                            noteActualQty = 0;
                            noteObservations = 'Omitido — Referencia no planificada en este bache';
                            console.log(`[generateNotes] ⏭️ Auto-skipped ${stage.stageName} (Not in output targets)`);
                        }
                    }

                    // ── Resolve productId to REAL flavor product for EMPAQUE/ENSAMBLE ──
                    // The template uses a generic product (e.g. ESCARCHADOR), but the actual
                    // note must point to the real flavor product from outputTargets (e.g. SABOR A CEREZA).
                    let finalProductId = resolvedProductId;
                    let finalStageName = stage.stageName;
                    if ((isEmpaque || isEnsamble) && noteProcessParams.product_id) {
                        finalProductId = noteProcessParams.product_id;
                        // Update stageName to show real product name instead of ESCARCHADOR
                        const matchedOT = (batch.outputTargets || []).find(t => t.productId === noteProcessParams.product_id);
                        if (matchedOT?.product?.name && finalStageName) {
                            // Replace generic product name with flavor-specific one
                            const genericName = stage.outputProduct?.name || '';
                            if (genericName) {
                                finalStageName = finalStageName.replace(genericName, matchedOT.product.name);
                            }
                        }
                    }

                    // Create Assembly Note
                    const note = await tx.assemblyNote.create({
                        data: {
                            noteNumber,
                            productId: finalProductId,
                            productionBatchId: batch.id,
                            templateId: template.id,
                            stageId: stage._fromSubTemplate ? null : stage.id,
                            stageOrder: globalStageOrder,
                            stageName: finalStageName,
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
                            } else {
                                // Apply the fractional scaling factor for Base/Jarabe/Esferificacion inputs
                                plannedQuantity = input.quantityPerUnit * scaleFactor;
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
                                        const knownFlavors = ['MANGO BICHE CON SAL', 'MANGO BICHE', 'ICE PINK', 'FRESA', 'CHAMOY', 'CAFE', 'CAFÉ', 'LYCHE', 'LYCHEE', 'CHICLE', 'MARACUYA', 'MORA', 'DURAZNO', 'ESCARCHADOR'];
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
            // Aplica al PESAJE de Liquipops y a G_PESAJE de Geniality (BASE
            // SIROPE, SABORIZACION, etc.). Si el operario no ha traspasado los
            // insumos a la Zona de Producción, el bache no arranca.
            const processCode = note.processType?.code;
            const consumingStage = processCode === 'PESAJE' || processCode === 'G_PESAJE';

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
            if (note.status === 'COMPLETED') throw new Error('Note already completed');

            // GUARD: CONTEO requires operatorId — prevent silent auto-complete
            if (note.processType?.code === 'CONTEO' && !operatorId) {
                throw new Error('CONTEO solo puede cerrarse manualmente por el operario (operatorId requerido)');
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

            // ── CONTEO completion: sync actual counts → BatchOutputTarget.actualUnits ──
            // plannedUnits preserves the original scheduled value for reporting.
            if (note.processType?.code === 'CONTEO') {
                const conteoMap = note.processParameters?.conteo;
                if (conteoMap && typeof conteoMap === 'object') {
                    for (const [productName, data] of Object.entries(conteoMap)) {
                        if (data.productId && data.actual != null) {
                            const actualUnits = parseInt(data.actual, 10);
                            console.log(`[completeNote] CONTEO actual: ${productName} → ${actualUnits} units`);
                            const updated = await tx.batchOutputTarget.updateMany({
                                where: {
                                    batchId: note.productionBatchId,
                                    productId: data.productId,
                                },
                                data: {
                                    actualUnits: actualUnits,
                                },
                            });
                            if (updated.count === 0 && actualUnits > 0) {
                                console.log(`[completeNote] 🆕 Creating outputTarget for unplanned ${productName}`);
                                await tx.batchOutputTarget.create({
                                    data: {
                                        batchId: note.productionBatchId,
                                        productId: data.productId,
                                        plannedUnits: 0,
                                        plannedWeightKg: 0,
                                        actualUnits: actualUnits,
                                    }
                                });
                            }
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
                        // Floor-to-zero: never let productionZoneStock go negative
                        const qtyToConsume = Math.round(qty);
                        const currentProduct = await tx.product.findUnique({
                            where: { id: item.componentId },
                            select: { productionZoneStock: true }
                        });
                        const currentZoneStock = currentProduct?.productionZoneStock || 0;
                        const safeDecrement = Math.min(qtyToConsume, Math.max(0, currentZoneStock));
                        if (safeDecrement > 0) {
                            await tx.product.update({
                                where: { id: item.componentId },
                                data: { productionZoneStock: { decrement: safeDecrement } }
                            });
                        }
                        console.log(`[completeNote] 📦 EMPAQUE stock-only consumed ${safeDecrement} of ${item.component?.name} (no MaterialLot)`);
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

            // ── Normalize Geniality process codes (defensive, matches assemblyService.js) ──
            // G_ENSAMBLE → ENSAMBLE, G_EMPAQUE → EMPAQUE so all downstream logic
            // (stock injection, RPA, MaterialLot) works identically.
            const normalizeCode = (code) => {
                if (!code) return code;
                if (code === 'G_ENSAMBLE') return 'ENSAMBLE';
                if (code === 'G_EMPAQUE') return 'EMPAQUE';
                return code;
            };
            if (note.processType) {
                note.processType = { ...note.processType, code: normalizeCode(note.processType.code) };
            }

            // ── DECOUPLED STOCK INJECTION (App-First, Siigo-Second) ──
            // Stock injection now happens at the ENSAMBLE step, which has the correct
            // scaled actualQuantity. PRE-ENSAMBLE (Pesaje) defers to ENSAMBLE.
            let producesOutput = false;
            let createdLotNumber = null;

            if (note.processType?.code === 'ENSAMBLE') {
                // ENSAMBLE step: INJECTS stock with the correct scaled actualQuantity.
                producesOutput = true;
                createdLotNumber = note.productionBatch?.batchNumber || null;
                console.log(`[completeNote] 📊 ENSAMBLE step — WILL inject stock + fire RPA. lotNumber: ${createdLotNumber} | qty: ${actualQuantity}`);
            } else if (note.processType?.code === 'FORMACION') {
                producesOutput = true;
                console.log(`[completeNote] 📊 FORMACION step — WILL inject stock. Stage: ${note.stageName} | qty: ${actualQuantity}`);
            } else if (note.productionBatchId && note.productId) {
                const batchNotes = await tx.assemblyNote.findMany({
                    where: { productionBatchId: note.productionBatchId },
                    select: { id: true, stageOrder: true, productId: true, processType: { select: { code: true } } },
                    orderBy: { stageOrder: 'asc' }
                });
                const myIdx = batchNotes.findIndex(n => n.id === noteId);
                let nextEnsambleForProduct = false;
                if (myIdx >= 0) {
                    for (let i = myIdx + 1; i < batchNotes.length; i++) {
                        if (batchNotes[i].productId === note.productId) {
                            nextEnsambleForProduct = normalizeCode(batchNotes[i].processType?.code) === 'ENSAMBLE';
                            break;
                        }
                    }
                }
                if (nextEnsambleForProduct) {
                    // PRE-ENSAMBLE: do NOT inject stock — deferred to ENSAMBLE
                    producesOutput = false;
                    console.log(`[completeNote] 📊 PRE-ENSAMBLE step — skipping stock injection (deferred to ENSAMBLE). Stage: ${note.stageName} | product: ${note.product?.name}`);
                } else {
                    console.log(`[completeNote] 📊 Intermediate step — no stock injection. Stage: ${note.stageName} | order: ${note.stageOrder}`);
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
                    // ── FINISHED PRODUCTS: create finishedLotStock per carrito ──
                    // So logistics can receive carts via handoffs without waiting
                    // for the entire lot to finish (which can take days).
                    const carritoNum = note.processParameters?.carritoNumber || null;
                    const reason = carritoNum
                        ? `Ensamble carrito #${carritoNum} — ${note.product?.name}`
                        : `Ensamble automático — ${note.product?.name}`;
                    try {
                        await finishedLotService.ingestFromProduction({
                            productId: note.productId,
                            lotNumber,
                            quantity: qty,
                            batchId: note.productionBatchId,
                            expiresAt: null,
                            userId: operatorId,
                            zone: 'PRODUCCION',
                            reason,
                            perCarrito: true,
                        });
                        console.log(`[completeNote] ✅ FinishedLotStock created for ${note.product?.name} — lot: ${lotNumber}, ${qty} uds in PRODUCCION`);
                    } catch (ingErr) {
                        if (ingErr.message?.startsWith('DUPLICATE_INGESTION')) {
                            console.warn(`[completeNote] ⚠️ Duplicate ingestion blocked for ${lotNumber}: ${ingErr.message}`);
                        } else {
                            throw ingErr;
                        }
                    }
                }
                createdLotNumber = lotNumber;
            } // end if (producesOutput)


            // ── Handle defective units from EMPAQUE (merma) ──
            // Frontend saves processParameters.empaque.defective_qty BEFORE calling complete
            const freshNote = await tx.assemblyNote.findUnique({ where: { id: noteId }, select: { processParameters: true } });
            const empaqueData = freshNote?.processParameters?.empaque;

            // ── FASE 5: Escribir approved_units / defective_units al BatchOutputTarget ──
            // Normaliza datos del JSON a columnas relacionales para reportes.
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

            const isEnsambleStep = ['ENSAMBLE', 'FORMACION'].includes(note.processType?.code);
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
            const qty = actualQuantity || result.targetQuantity;

            // ── GLOBAL RPA DUPLICATE LOCK ──────────────────────────────────────────────
            prisma.rpaExecution.findFirst({
                where: { assemblyNoteId: noteId, status: { in: ['PENDING', 'RUNNING', 'SUCCESS'] } }
            }).then(duplicateLock => {
                if (duplicateLock) {
                    console.log(`[completeNote] ⏭️ RPA LOCKED — Execution already exists for note ${noteId}. Preventing Geniality duplicates.`);
                    return; // Skip queueing RPA
                }

                // Create RPA execution record + enqueue
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
            }).catch(e => console.error('RPA execution error:', e.message));
            }).catch(e => console.error('RPA duplicate check error:', e.message));
        }

        return result.updatedNote;
    }
}

module.exports = new AssemblyService();
