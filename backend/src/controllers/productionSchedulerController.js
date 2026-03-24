const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const XLSX = require('xlsx');
const path = require('path');
const configController = require('./configController');

// Helper: Parse size to Kg
// density: g/cm³ (= g/mL). Default 1.0 for water-like. Siropes use 1.35.
const parseSize = (name, density = 1.0) => {
    const regex = /X\s*(\d+)\s*(ML|GR|G|L|KG)/i;
    const match = name.match(regex);
    if (!match) return { value: 0, unit: 'N/A', kgFactor: 0 };

    let value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    let kgFactor = 0;

    if (unit === 'ML') {
        // ML → grams via density, then to kg
        kgFactor = (value * density) / 1000;
    } else if (unit === 'GR' || unit === 'G') {
        kgFactor = value / 1000;
    } else if (unit === 'L' || unit === 'KG') {
        kgFactor = value;
    }
    return { value, unit, kgFactor: Math.round(kgFactor * 10000) / 10000 };
};

// Helper: Calculate Effective Stock (Excluding Maquilas)
const getEffectiveStock = (product) => {
    // If no warehouse data, fallback to total currentStock
    if (!product.warehouses || !Array.isArray(product.warehouses) || product.warehouses.length === 0) {
        return product.currentStock;
    }

    // Filter out Maquilas
    // We assume warehouses with "MAQUILA" in name are external/irrelevant for production planning coverage
    const relevantWarehouses = product.warehouses.filter(w =>
        w.name && !w.name.toUpperCase().includes('MAQUILA')
    );

    // Sum relevant quantities
    const effectiveQty = relevantWarehouses.reduce((acc, w) => acc + (w.quantity || 0), 0);
    return effectiveQty;
};

// Historical Distribution (Fallback)
const DEFAULT_DISTRIBUTION = { '350': 0.40, '1150': 0.35, '3400': 0.25 };

exports.getSuggestions = async (req, res) => {
    try {
        const line = req.query.line || 'liquipops'; // 'liquipops' or 'geniality'
        const groupName = line === 'geniality' ? 'GENIALITY' : 'LIQUIPOPS';

        // 1. Fetch Products
        const products = await prisma.product.findMany({
            where: {
                group: { name: groupName },
                classification: 'PRODUCTO_TERMINADO',
                active: true
            }
        });

        // 1b. Fetch System Configuration
        const globalConfig = await configController.getInternalConfig() || {};

        // Resolve Config based on Line
        const config = line === 'geniality' ? {
            targetDays: globalConfig.geniality_targetDays || globalConfig.targetDays || 8,
            alertYellow: globalConfig.geniality_alertYellow || globalConfig.alertYellow || 12,
            alertRed: globalConfig.geniality_alertRed || globalConfig.alertRed || 3,
            syrupRatio: 1.0 // Geniality has NO growth
        } : {
            targetDays: globalConfig.targetDays || 8,
            alertYellow: globalConfig.alertYellow || 12,
            alertRed: globalConfig.alertRed || 3,
            syrupRatio: globalConfig.syrupRatio || 0.70
        };

        const BATCH_SIZE = line === 'geniality' ? 100 : 120;
    const DENSITY = line === 'geniality' ? 1.35 : 1.0; // Sirope density g/cm³


        // 2. Read REAL Sales Data from Excel
        const filePath = path.join(__dirname, '../../Movimiento 2025.xlsx');
        let workbook;
        try {
            workbook = XLSX.readFile(filePath);
        } catch (e) {
            console.error("Excel not found, using DB Only");
        }

        const flavorSales = {}; // { Flavor: TotalKg }

        if (workbook) {
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(sheet);

            data.forEach(row => {
                const code = row['Código producto'];
                // Match by SKU to our filtered Link products
                const product = products.find(p => p.sku === code);

                if (product && product.flavor) {
                    const flavor = product.flavor.toUpperCase();
                    const sizeInfo = parseSize(product.name, DENSITY); // Parse DB name as it's cleaner
                    const soldUnits = (row['Cantidad salida'] || 0); // Correct Column Name
                    const soldKg = soldUnits * sizeInfo.kgFactor;

                    if (!flavorSales[flavor]) flavorSales[flavor] = 0;
                    flavorSales[flavor] += soldKg;
                }
            });
        }

        // 3. Group by Flavor & Build Suggestion
        const flavorGroups = {};
        products.forEach(p => {
            if (!p.flavor) return;
            const flavor = p.flavor.toUpperCase();
            if (!flavorGroups[flavor]) flavorGroups[flavor] = [];
            flavorGroups[flavor].push(p);
        });

        const suggestions = Object.entries(flavorGroups).map(([flavor, items]) => {
            let totalStockKg = 0;
            const stockDetails = [];

            items.forEach(p => {
                const sizeInfo = parseSize(p.name, DENSITY);
                const kgFactor = sizeInfo.kgFactor || 0;

                // USE GLOBAL STOCK (Include Maquilas)
                const stockKg = p.currentStock * kgFactor;

                totalStockKg += stockKg;

                // FIX: Show ALL stock, even fitting negative/zero if meaningful
                let label = `${sizeInfo.value}${sizeInfo.unit === 'ML' ? 'ml' : sizeInfo.unit === 'KG' ? 'kg' : sizeInfo.unit}`;
                stockDetails.push({
                    label,
                    units: p.currentStock, // Show global units
                    kg: stockKg,
                    sizeWeight: kgFactor // Use this for sorting
                });
            });

            // Calculate Metrics
            // SWITCH: Use DB 'dailyVelocity' (calculated elsewhere, e.g. 3-months avg) 
            // instead of Excel 1-year average.
            let dailyConsumptionKg = 0;
            items.forEach(p => {
                const sizeInfo = parseSize(p.name, DENSITY);
                const kgFactor = sizeInfo.kgFactor || 0;
                // dailyVelocity is in Units/Day. Convert to Kg/Day.
                // Fallback to 0 if null
                const velocity = p.dailyVelocity || 0;
                dailyConsumptionKg += (velocity * kgFactor);
            });

            // Days of Stock
            // If No consumption, assume infinite coverage (999)
            const daysRemaining = dailyConsumptionKg > 0.05 ? (totalStockKg / dailyConsumptionKg) : 999;

            // Debug Log (To verify values in logs if needed)
            // console.log(`Flavor: ${flavor}, DailyKg: ${dailyConsumptionKg.toFixed(2)}, StockKg: ${totalStockKg}`);

            let status = 'GREEN';
            // Logic: Dynamic from Config
            if (daysRemaining < config.alertYellow) status = 'YELLOW';
            if (daysRemaining < config.alertRed) status = 'RED';

            // FORCE RED if Negative Stock (Critical Deficit)
            if (totalStockKg < 0) {
                status = 'RED';
            }


            // User Request: "amarillo si al menos uno de los tamaños esta en riesgo"
            const hasMissingSize = items.some(p => p.currentStock <= 0);
            if (hasMissingSize && status === 'GREEN') {
                status = 'YELLOW';
            }

            // Available Sizes String
            // Fix Sort: Sort by Unit Size (sizeWeight) not Total Stock Kg
            stockDetails.sort((a, b) => a.sizeWeight - b.sizeWeight);

            // Show ALL items including zero (User request: "si no hay inventario... mostar lo que hay")
            const displaySizes = stockDetails;

            const availableSizesStr = displaySizes.length > 0
                ? displaySizes.map(d => `${d.label}: ${d.units}`).join(', ')
                : "0";

            // Suggestion Logic
            let suggestedAction = "OK";
            if (status !== 'GREEN' || totalStockKg < 0) {
                // Apply syrup ratio: we only need X% of product weight as syrup
                const SYRUP_RATIO = config.syrupRatio;
                const TARGET_DAYS = config.targetDays;
                const deficitKg = ((TARGET_DAYS * dailyConsumptionKg) - totalStockKg) * SYRUP_RATIO;

                // Target: Multiples of BATCH_SIZE
                let baseTarget = Math.max(0, deficitKg); // No buffer

                // If negative stock, ensure we cover it (also apply syrup ratio)
                if (totalStockKg < 0) baseTarget += Math.abs(totalStockKg) * SYRUP_RATIO;

                // Round UP to nearest BATCH_SIZE
                let target = Math.ceil(Math.max(1, baseTarget) / BATCH_SIZE) * BATCH_SIZE;

                // Minimum batch is BATCH_SIZE
                if (target < BATCH_SIZE) target = BATCH_SIZE;

                // Special Case: No consumption but Negative Stock
                if (dailyConsumptionKg < 0.05 && totalStockKg < 0) {
                    const hole = Math.abs(totalStockKg) * SYRUP_RATIO;
                    target = Math.ceil(hole / BATCH_SIZE) * BATCH_SIZE;
                }

                suggestedAction = `Producir ${Math.round(target)}kg`;
            }

            return {
                flavor,
                daysRemaining: Math.round(daysRemaining * 10) / 10,
                status,
                dailyConsumptionKg: Math.round(dailyConsumptionKg * 100) / 100,
                currentStockKg: Math.round(totalStockKg),
                availableSizes: availableSizesStr || "Sin Stock",
                suggestedAction,
                hasMissingSize // Flag for sorting
            };
        }).sort((a, b) => {
            // Sort Logic:
            // Tier 1: CONFIRMED GLOBAL STOCKOUT (Red due to Global Negative)
            // Removed 'hasMissingSize' from here to respect Volume Priority for "Yellow" items
            const isStockoutA = a.currentStockKg < 0;
            const isStockoutB = b.currentStockKg < 0;
            if (isStockoutA && !isStockoutB) return -1;
            if (!isStockoutA && isStockoutB) return 1;

            // Tier 1 Tie-Breaker: Sort by Volume (Impact)
            if (isStockoutA && isStockoutB) {
                return b.dailyConsumptionKg - a.dailyConsumptionKg;
            }

            // Tier 2: Imminent Risks (< 3 days)
            const isPanicA = a.daysRemaining < 3;
            const isPanicB = b.daysRemaining < 3;
            if (isPanicA && !isPanicB) return -1;
            if (!isPanicA && isPanicB) return 1;

            // Tier 3: Action Needed (Red or Yellow status, i.e., days < 12)
            const isActionA = a.daysRemaining < 12; // Updated to match yellow threshold
            const isActionB = b.daysRemaining < 12;

            // If both need action (or both don't), sort by ROTATION (Volume)
            // This answers user request: "Maracuya (High Vol, 3.4 days) > Mango Biche (Low Vol, 2.2 days)"
            if (isActionA === isActionB) {
                return b.dailyConsumptionKg - a.dailyConsumptionKg;
            }

            // Otherwise, Action Needed comes first
            return isActionA ? -1 : 1;
        });

        res.json(suggestions);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error calculating suggestions' });
    }
};

exports.calculateBatchMix = async (req, res) => {
    const { flavor } = req.params;
    const line = req.query.line || 'liquipops';
    const groupName = line === 'geniality' ? 'GENIALITY' : 'LIQUIPOPS';

    try {
        const products = await prisma.product.findMany({
            where: {
                group: { name: groupName },
                flavor: { equals: flavor, mode: 'insensitive' },
                active: true
            }
        });

        if (products.length === 0) return res.status(404).json({ error: 'Flavor not found' });

        const globalConfig = await configController.getInternalConfig() || {};

        // Resolve Config based on Line
        const config = line === 'geniality' ? {
            targetDays: globalConfig.geniality_targetDays || globalConfig.targetDays || 8,
            syrupRatio: 1.0 // Geniality has NO growth
        } : {
            targetDays: globalConfig.targetDays || 8,
            syrupRatio: globalConfig.syrupRatio || 0.70
        };

        const TARGET_DAYS = config.targetDays;
        const SYRUP_RATIO = config.syrupRatio;
        const BATCH_SIZE = line === 'geniality' ? 100 : 120;
        const DENSITY = line === 'geniality' ? 1.35 : 1.0; // Sirope density g/cm³

        let totalNeedKg = 0;
        const productNeeds = [];

        products.forEach(p => {
            const sizeInfo = parseSize(p.name, DENSITY);
            if (sizeInfo.kgFactor === 0) return;

            // Use Global Stock
            const velocity = p.dailyVelocity || 0; // Use DB 3-month avg
            const targetStock = velocity * TARGET_DAYS;
            const deficit = Math.max(0, targetStock - p.currentStock);
            // IMPORTANTE: Solo el X% (default 70%) del peso final viene del jarabe
            const deficitKg = deficit * sizeInfo.kgFactor * SYRUP_RATIO;

            productNeeds.push({
                product: p,
                kgFactor: sizeInfo.kgFactor,
                deficitUnits: deficit,
                deficitKg
            });
            totalNeedKg += deficitKg;
        });

        // DYNAMIC MIX LOGIC: Calculate Sales Share for Fill Strategy
        // Instead of DEFAULT_DISTRIBUTION (fixed %), use actual daily consumption ratio
        let totalDailyVolumeKg = 0;
        productNeeds.forEach(item => {
            // Factor in Kg
            const volumeKg = (item.product.dailyVelocity || 0); // Corrected to use DB Velocity
            // avgDailyConsumption is typically Units/Day. So Convert to Kg.
            const volumeKgVal = volumeKg * item.kgFactor;
            item.dailyVolumeKg = volumeKgVal;
            totalDailyVolumeKg += volumeKgVal;
        });

        // Fallback if no sales history: use equal distribution or keep old default as last resort?
        // Let's use old default only if totalDailyVolume is 0
        // Match 'getSuggestions' Aggressive Logic:
        const useFallback = totalDailyVolumeKg <= 0;

        // Calculate Total Flavor Stock to see if we need negative stock recovery
        let totalFlavorStock = 0;
        products.forEach(p => {
            const sizeInfo = parseSize(p.name, DENSITY);
            if (sizeInfo.kgFactor) totalFlavorStock += (p.currentStock * sizeInfo.kgFactor);
        });

        // If total stock is negative, add absolute value to recover deficit
        let boostedNeedKg = totalNeedKg;
        if (totalFlavorStock < 0) {
            boostedNeedKg += Math.abs(totalFlavorStock) * SYRUP_RATIO; // Apply syrup ratio to negative stock too
        }

        // Determine Target Batch Size (Multiples of BATCH_SIZE)
        // NO BUFFER - Calculate exactly what's needed
        let targetTotalKg = Math.ceil(boostedNeedKg / BATCH_SIZE) * BATCH_SIZE;

        console.log('DEBUG MIX:', {
            flavor,
            totalNeedKg, // Original
            boostedNeedKg,
            totalFlavorStock,
            targetTotalKg,
            productsCount: products.length
        });

        // Strategy implies how we fill it
        let strategy = 'FILL_TO_BATCH';

        const finalMix = [];
        productNeeds.forEach(item => {
            let allocatedKg = 0;
            if (strategy === 'EXACT') {
                allocatedKg = item.deficitKg;
            } else if (strategy === 'CAP_MAX') {
                const ratio = item.deficitKg / totalNeedKg;
                allocatedKg = targetTotalKg * ratio;
            } else if (strategy === 'FILL_MIN' || strategy === 'FILL_TO_BATCH') { // Match Strategy
                const remainder = targetTotalKg - totalNeedKg;

                let extraKg = 0;
                if (useFallback) {
                    // Identify size key
                    let sizeKey = '350';
                    if (item.kgFactor > 3) sizeKey = '3400';
                    else if (item.kgFactor > 1) sizeKey = '1150';
                    extraKg = remainder * (DEFAULT_DISTRIBUTION[sizeKey] || 0.33);
                } else {
                    // DYNAMIC ALLOCATION: Share of Volume
                    const share = item.dailyVolumeKg / totalDailyVolumeKg;
                    extraKg = remainder * share;
                }

                allocatedKg = item.deficitKg + extraKg;
            }

            // Calculate units
            const syrupNeededPerUnit = item.kgFactor * SYRUP_RATIO;
            const plannedUnits = Math.round(allocatedKg / syrupNeededPerUnit);
            finalMix.push({
                productId: item.product.id,
                sku: item.product.sku,
                name: item.product.name,
                sizeLabel: `${Math.round(item.kgFactor * 1000) / 1000} Kg`,
                kgFactor: Math.round(item.kgFactor * 1000) / 1000, // Exposed for frontend reactivity
                plannedUnits,
                plannedWeightKg: Math.round(plannedUnits * item.kgFactor * 100) / 100
            });
        });

        const totalPlannedKg = finalMix.reduce((acc, curr) => acc + curr.plannedWeightKg, 0);

        // Calculate actual syrup batches needed (for display)
        const syrupBatchesNeeded = Math.ceil(targetTotalKg / BATCH_SIZE);

        res.json({
            flavor,
            strategy,
            totalPlannedKg, // Total weight of final products
            totalSyrupKg: targetTotalKg, // Total syrup needed from batches 
            targetBatchCount: syrupBatchesNeeded, // Number of BATCH_SIZE batches needed
            targetTotalKg, // Legacy field
            mix: finalMix
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error calculating mix' });
    }
};

exports.createBatch = async (req, res) => {
    console.log("DEBUG: createBatch called", req.body);
    const { flavor, scheduledStart, scheduledEnd, mix, baseWeight, batchIndex, totalBatches, notes } = req.body;
    try {
        // Generate batch number: FLAVOR-AAMMDD-HHMM (Colombia TZ)
        const now = new Date();
        const co = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
        const yy = String(co.getFullYear()).slice(-2);
        const MM = String(co.getMonth() + 1).padStart(2, '0');
        const dd = String(co.getDate()).padStart(2, '0');
        const hh = String(co.getHours()).padStart(2, '0');
        const mm = String(co.getMinutes()).padStart(2, '0');
        const flavorCode = (flavor || 'BATCH').toUpperCase().replace(/\s+/g, '-');
        const batchNumber = `${flavorCode}-${yy}${MM}${dd}-${hh}${mm}`;
        const totalOutput = mix.reduce((acc, curr) => acc + curr.plannedWeightKg, 0);

        const batch = await prisma.productionBatch.create({
            data: {
                batchNumber,
                flavor,
                scheduledStart: new Date(scheduledStart),
                scheduledEnd: new Date(scheduledEnd),
                baseWeight: Number(baseWeight),
                projectedTotalWeight: totalOutput,
                status: 'PENDING',
                notes: notes || null,
                outputTargets: {
                    create: mix.map(m => ({
                        productId: m.productId,
                        plannedUnits: Number(m.plannedUnits),
                        plannedWeightKg: Number(m.plannedWeightKg)
                    }))
                }
            }
        });
        res.status(201).json(batch);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error creating batch' });
    }
};

exports.updateBatch = async (req, res) => {
    try {
        const { id } = req.params;
        const { scheduledStart, scheduledEnd, status, notes } = req.body;

        const updateData = {};
        if (scheduledStart) updateData.scheduledStart = new Date(scheduledStart);
        if (scheduledEnd) updateData.scheduledEnd = new Date(scheduledEnd);
        if (status) updateData.status = status;
        if (notes !== undefined) updateData.notes = notes;

        const batch = await prisma.productionBatch.update({
            where: { id },
            data: updateData
        });
        res.json(batch);
    } catch (error) {
        console.error("Error updating batch:", error);
        res.status(500).json({ error: 'Error updating batch' });
    }
};

// NEW: Fetch Schedule
exports.getSchedule = async (req, res) => {
    try {
        const line = req.query.line || 'liquipops';
        const groupName = line === 'geniality' ? 'GENIALITY' : 'LIQUIPOPS';

        const batches = await prisma.productionBatch.findMany({
            where: {
                status: {
                    in: ['PENDING', 'STAGE_1_BASE', 'STAGE_2_JARABE', 'STAGE_3_ESFERIFICACION', 'STAGE_4_PRODUCTO_FINAL', 'LABELING', 'COMPLETED']
                },
                // Filter by Line: Look for batches that produce items of the correct group
                outputTargets: {
                    some: {
                        product: {
                            group: { name: groupName }
                        }
                    }
                }
            },
            include: {
                outputTargets: {
                    include: { product: true }
                }
            }
        });

        const events = batches.map(b => {
            const parts = b.batchNumber.split('-');
            const seq = (parts.length >= 4) ? ` [${parts[2]}/${parts[3] || '?'}]` : '';
            // Detect line from group: if any output target is in GENIALITY group, use sirope density
            const isGenialityBatch = b.outputTargets.some(t => t.product?.group?.name === 'GENIALITY' || t.product?.name?.includes('SIROPE'));
            const batchDensity = isGenialityBatch ? 1.35 : 1.0;

            return {
                id: b.id,
                title: `${b.flavor}${seq} (${Math.round(b.baseWeight || 0)}kg)`,
                start: b.scheduledStart,
                end: b.scheduledEnd,
                flavor: b.flavor,
                status: b.status,
                baseWeight: b.baseWeight, // Exposed for frontend calculations
                notes: b.notes, // Include notes for auxiliary events
                mix: b.outputTargets.map(t => {
                    const sizeInfo = parseSize(t.product.name, batchDensity);
                    return {
                        id: t.productId,
                        productId: t.productId,  // Frontend launch uses this field
                        name: t.product.name,
                        sku: t.product.sku,
                        plannedUnits: t.plannedUnits,
                        plannedWeightKg: t.plannedWeightKg,
                        sizeLabel: `${sizeInfo.value}${sizeInfo.unit}`
                    };
                })
            };
        });

        res.json(events);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching schedule' });
    }
};

exports.deleteBatch = async (req, res) => {
    try {
        const { id } = req.params;

        // Cascade: delete related records first
        // 1. Find assembly note IDs for this batch
        const noteIds = (await prisma.assemblyNote.findMany({
            where: { productionBatchId: id },
            select: { id: true }
        })).map(n => n.id);

        // 2. Delete lot consumptions linked to these notes
        if (noteIds.length > 0) {
            await prisma.lotConsumption.deleteMany({ where: { assemblyNoteId: { in: noteIds } } });
        }

        // 3. Delete assembly notes (NoteItems, ProcessVariables, QualityChecks cascade via FK)
        await prisma.assemblyNote.deleteMany({ where: { productionBatchId: id } });

        // 4. Delete output targets
        await prisma.batchOutputTarget.deleteMany({ where: { batchId: id } });

        // 5. Delete the batch
        await prisma.productionBatch.delete({ where: { id } });

        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting batch:", error);
        res.status(500).json({ error: 'Error deleting batch: ' + error.message });
    }
};

exports.deleteAllBatches = async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'No batch IDs provided' });
        }
        const batchIds = ids;

        // Step 1: Delete assembly notes (NoteItems, ProcessVariables, QualityChecks cascade automatically via FK)
        await prisma.assemblyNote.deleteMany({ where: { productionBatchId: { in: batchIds } } });

        // Step 2: Delete output targets
        await prisma.batchOutputTarget.deleteMany({ where: { batchId: { in: batchIds } } });

        // Now delete the batches
        const deleted = await prisma.productionBatch.deleteMany({ where: { id: { in: batchIds } } });

        res.json({ success: true, deleted: deleted.count });
    } catch (error) {
        console.error("Error deleting all batches:", error);
        res.status(500).json({ error: 'Error deleting batches: ' + error.message });
    }
};
