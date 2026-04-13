const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
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
            syrupRatio: 1.0, // Geniality has NO growth
            safetyStockDays: globalConfig.geniality_safetyStockDays || globalConfig.safetyStockDays || 2
        } : {
            targetDays: globalConfig.targetDays || 8,
            alertYellow: globalConfig.alertYellow || 12,
            alertRed: globalConfig.alertRed || 3,
            syrupRatio: globalConfig.syrupRatio || 0.70,
            safetyStockDays: globalConfig.safetyStockDays || 2
        };

        // 1c. Fetch Order Deficit (real remaining = requestedQty - scannedQty)
        // Note: pendingQty is unreliable because approveOrder sets it to 0
        const productIds = products.map(p => p.id);
        const orderItemsForDeficit = await prisma.orderItem.findMany({
            where: {
                productId: { in: productIds },
                order: { status: { in: ['PENDING', 'APPROVED', 'IN_PICKING'] } }
            },
            select: {
                productId: true,
                requestedQty: true,
                pickingItems: { select: { scannedQty: true } }
            }
        });
        // Map: productId -> deficit units (requested - scanned)
        const orderDeficitMap = {};
        for (const item of orderItemsForDeficit) {
            const scanned = item.pickingItems?.reduce((s, pi) => s + pi.scannedQty, 0) || 0;
            const remaining = Math.max(0, item.requestedQty - scanned);
            if (remaining > 0) {
                orderDeficitMap[item.productId] = (orderDeficitMap[item.productId] || 0) + remaining;
            }
        }

        // 1d. Fetch In-Progress Production (batches not yet completed)
        const inProgressRaw = await prisma.batchOutputTarget.groupBy({
            by: ['productId'],
            where: {
                productId: { in: productIds },
                batch: { status: { notIn: ['COMPLETED', 'FAILED'] } }
            },
            _sum: { plannedUnits: true }
        });
        const inProgressMap = {};
        for (const p of inProgressRaw) {
            inProgressMap[p.productId] = p._sum.plannedUnits || 0;
        }

        // 1e. Fetch Scheduled/Active production for per-size breakdown
        const scheduledRaw = await prisma.batchOutputTarget.groupBy({
            by: ['productId'],
            where: {
                productId: { in: productIds },
                batch: { status: { notIn: ['COMPLETED', 'FAILED'] } }
            },
            _sum: { plannedUnits: true }
        });
        const scheduledMap = {};
        for (const p of scheduledRaw) {
            scheduledMap[p.productId] = p._sum.plannedUnits || 0;
        }

        const BATCH_SIZE = line === 'geniality' ? 100 : 120;
    const DENSITY = line === 'geniality' ? 1.35 : 1.0; // Sirope density g/cm³


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
            let totalOrderDeficitUnits = 0;
            let totalOrderDeficitKg = 0;
            let totalInProgressUnits = 0;
            let totalInProgressKg = 0;
            const stockDetails = [];

            items.forEach(p => {
                const sizeInfo = parseSize(p.name, DENSITY);
                const kgFactor = sizeInfo.kgFactor || 0;

                // USE GLOBAL STOCK (Include Maquilas)
                const stockKg = p.currentStock * kgFactor;
                totalStockKg += stockKg;

                // Order deficit for this product
                const deficitUnits = orderDeficitMap[p.id] || 0;
                totalOrderDeficitUnits += deficitUnits;
                totalOrderDeficitKg += deficitUnits * kgFactor;

                // In-progress production for this product
                const inProgressUnits = inProgressMap[p.id] || 0;
                totalInProgressUnits += inProgressUnits;
                totalInProgressKg += inProgressUnits * kgFactor;

                let label = `${sizeInfo.value}${sizeInfo.unit === 'ML' ? 'ml' : sizeInfo.unit === 'KG' ? 'kg' : sizeInfo.unit}`;
                stockDetails.push({
                    label,
                    units: p.currentStock,
                    kg: stockKg,
                    sizeWeight: kgFactor,
                    deficitUnits, // per-size deficit for display
                    scheduledUnits: scheduledMap[p.id] || 0
                });
            });

            // === EFFECTIVE STOCK ===
            // Stock real = lo que tienes - lo que debes (pedidos) + lo que viene (producción en curso)
            const effectiveStockKg = totalStockKg - totalOrderDeficitKg + totalInProgressKg;

            // Calculate daily consumption
            let dailyConsumptionKg = 0;
            items.forEach(p => {
                const sizeInfo = parseSize(p.name, DENSITY);
                const kgFactor = sizeInfo.kgFactor || 0;
                const velocity = p.dailyVelocity || 0;
                dailyConsumptionKg += (velocity * kgFactor);
            });

            // Days of Stock — use EFFECTIVE stock (accounting for orders + production)
            const daysRemaining = dailyConsumptionKg > 0.05 ? (effectiveStockKg / dailyConsumptionKg) : 999;

            let status = 'GREEN';
            if (daysRemaining < config.alertYellow) status = 'YELLOW';
            if (daysRemaining < config.alertRed) status = 'RED';

            // FORCE RED if Effective Stock is negative
            if (effectiveStockKg < 0) status = 'RED';

            // "amarillo si al menos uno de los tamaños esta en riesgo"
            const hasMissingSize = items.some(p => p.currentStock <= 0);
            if (hasMissingSize && status === 'GREEN') status = 'YELLOW';

            // Available Sizes String
            stockDetails.sort((a, b) => a.sizeWeight - b.sizeWeight);
            const availableSizesStr = stockDetails.length > 0
                ? stockDetails.map(d => `${d.label}: ${d.units}`).join(', ')
                : "0";

            // === SUGGESTION LOGIC (uses effective stock + safety stock) ===
            let suggestedAction = "OK";
            if (status !== 'GREEN' || effectiveStockKg < 0) {
                const SYRUP_RATIO = config.syrupRatio;
                const TARGET_DAYS = config.targetDays;
                const SAFETY_DAYS = config.safetyStockDays;

                // Deficit = what we need for target days + safety - what we effectively have
                const deficitKg = ((TARGET_DAYS + SAFETY_DAYS) * dailyConsumptionKg - effectiveStockKg) * SYRUP_RATIO;

                let baseTarget = Math.max(0, deficitKg);

                // If effective stock is negative, ensure we cover the hole
                if (effectiveStockKg < 0) baseTarget += Math.abs(effectiveStockKg) * SYRUP_RATIO;

                let target = Math.ceil(Math.max(1, baseTarget) / BATCH_SIZE) * BATCH_SIZE;
                if (target < BATCH_SIZE) target = BATCH_SIZE;

                // Special Case: No consumption but Negative effective stock
                if (dailyConsumptionKg < 0.05 && effectiveStockKg < 0) {
                    const hole = Math.abs(effectiveStockKg) * SYRUP_RATIO;
                    target = Math.ceil(hole / BATCH_SIZE) * BATCH_SIZE;
                }

                suggestedAction = `Producir ${Math.round(target)}kg`;
            }

            // Backorder: NET deficit = demand - current stock - in-progress production
            // Shows how much STILL NEEDS to be scheduled
            const totalBackorderKg = Math.max(0, Math.round(totalOrderDeficitKg - totalStockKg - totalInProgressKg));

            return {
                flavor,
                daysRemaining: Math.round(daysRemaining * 10) / 10,
                status,
                dailyConsumptionKg: Math.round(dailyConsumptionKg * 100) / 100,
                currentStockKg: Math.round(totalStockKg),
                effectiveStockKg: Math.round(effectiveStockKg),
                orderDeficitUnits: totalOrderDeficitUnits,
                totalBackorderKg,
                inProgressUnits: totalInProgressUnits,
                inProgressKg: Math.round(totalInProgressKg),
                availableSizes: availableSizesStr || "Sin Stock",
                stockDetails,
                suggestedAction,
                hasMissingSize
            };
        }).sort((a, b) => {
            // Sort Logic:
            // Tier 0: Items with BACKORDERS (unfulfilled orders) — highest priority
            const hasBackorderA = a.totalBackorderKg > 0;
            const hasBackorderB = b.totalBackorderKg > 0;
            if (hasBackorderA && !hasBackorderB) return -1;
            if (!hasBackorderA && hasBackorderB) return 1;
            if (hasBackorderA && hasBackorderB) {
                return b.totalBackorderKg - a.totalBackorderKg; // bigger deficit first
            }

            // Tier 1: CONFIRMED STOCKOUT (Effective stock negative)
            const isStockoutA = a.effectiveStockKg < 0;
            const isStockoutB = b.effectiveStockKg < 0;
            if (isStockoutA && !isStockoutB) return -1;
            if (!isStockoutA && isStockoutB) return 1;
            if (isStockoutA && isStockoutB) {
                return b.dailyConsumptionKg - a.dailyConsumptionKg;
            }

            // Tier 2: Imminent Risks (< 3 days)
            const isPanicA = a.daysRemaining < 3;
            const isPanicB = b.daysRemaining < 3;
            if (isPanicA && !isPanicB) return -1;
            if (!isPanicA && isPanicB) return 1;

            // Tier 3: Action Needed (days < 12)
            const isActionA = a.daysRemaining < 12;
            const isActionB = b.daysRemaining < 12;
            if (isActionA === isActionB) {
                return b.dailyConsumptionKg - a.dailyConsumptionKg;
            }
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

        const config = line === 'geniality' ? {
            targetDays: globalConfig.geniality_targetDays || globalConfig.targetDays || 8,
            syrupRatio: 1.0
        } : {
            targetDays: globalConfig.targetDays || 8,
            syrupRatio: globalConfig.syrupRatio || 0.70
        };

        const TARGET_DAYS = config.targetDays;
        const SYRUP_RATIO = config.syrupRatio;
        const BATCH_SIZE = line === 'geniality' ? 100 : 120;
        const DENSITY = line === 'geniality' ? 1.35 : 1.0;

        // Fetch real order demand per product
        const productIds = products.map(p => p.id);
        const orderItemsRaw = await prisma.orderItem.findMany({
            where: {
                productId: { in: productIds },
                order: { status: { in: ['PENDING', 'APPROVED', 'IN_PICKING'] } }
            },
            select: {
                productId: true,
                requestedQty: true,
                pickingItems: { select: { scannedQty: true } }
            }
        });
        const orderDemandMap = {};
        orderItemsRaw.forEach(item => {
            const scanned = item.pickingItems?.reduce((s, pi) => s + pi.scannedQty, 0) || 0;
            const remaining = Math.max(0, item.requestedQty - scanned);
            if (remaining > 0) orderDemandMap[item.productId] = (orderDemandMap[item.productId] || 0) + remaining;
        });

        // Fetch in-progress production per product
        const inProgressRaw = await prisma.batchOutputTarget.groupBy({
            by: ['productId'],
            where: {
                productId: { in: productIds },
                batch: { status: { notIn: ['COMPLETED', 'FAILED'] } }
            },
            _sum: { plannedUnits: true }
        });
        const inProgressMap = {};
        for (const d of inProgressRaw) {
            inProgressMap[d.productId] = d._sum.plannedUnits || 0;
        }

        let totalNeedKg = 0;
        const productNeeds = [];

        products.forEach(p => {
            const sizeInfo = parseSize(p.name, DENSITY);
            if (sizeInfo.kgFactor === 0) return;

            const velocity = p.dailyVelocity || 0;
            const targetStock = velocity * TARGET_DAYS;
            const deficit = Math.max(0, targetStock - p.currentStock);
            const deficitKg = deficit * sizeInfo.kgFactor * SYRUP_RATIO;

            const orderDemand = orderDemandMap[p.id] || 0;
            const inProgress = inProgressMap[p.id] || 0;
            const netOrderNeed = Math.max(0, orderDemand - Math.max(0, p.currentStock) - inProgress);

            productNeeds.push({
                product: p,
                kgFactor: sizeInfo.kgFactor,
                packSize: p.packSize || 1,
                sizeValue: sizeInfo.value,
                deficitUnits: deficit,
                deficitKg,
                orderDemandUnits: orderDemand,
                netOrderNeedUnits: netOrderNeed
            });
            totalNeedKg += deficitKg;
        });

        let totalDailyVolumeKg = 0;
        productNeeds.forEach(item => {
            const volumeKgVal = (item.product.dailyVelocity || 0) * item.kgFactor;
            item.dailyVolumeKg = volumeKgVal;
            totalDailyVolumeKg += volumeKgVal;
        });

        const useFallback = totalDailyVolumeKg <= 0;

        let totalFlavorStock = 0;
        products.forEach(p => {
            const sizeInfo = parseSize(p.name, DENSITY);
            if (sizeInfo.kgFactor) totalFlavorStock += (p.currentStock * sizeInfo.kgFactor);
        });

        let boostedNeedKg = totalNeedKg;
        if (totalFlavorStock < 0) {
            boostedNeedKg += Math.abs(totalFlavorStock) * SYRUP_RATIO;
        }

        let targetTotalKg = Math.ceil(boostedNeedKg / BATCH_SIZE) * BATCH_SIZE;

        console.log('DEBUG MIX:', { flavor, totalNeedKg, boostedNeedKg, totalFlavorStock, targetTotalKg });

        let strategy = 'FILL_TO_BATCH';

        // === FIRST PASS: allocate raw units ===
        const rawAllocations = [];
        productNeeds.forEach(item => {
            const remainder = targetTotalKg - totalNeedKg;
            let extraKg = 0;
            if (useFallback) {
                let sizeKey = '350';
                if (item.kgFactor > 3) sizeKey = '3400';
                else if (item.kgFactor > 1) sizeKey = '1150';
                extraKg = remainder * (DEFAULT_DISTRIBUTION[sizeKey] || 0.33);
            } else {
                const share = item.dailyVolumeKg / totalDailyVolumeKg;
                extraKg = remainder * share;
            }
            const allocatedKg = item.deficitKg + extraKg;

            const syrupNeededPerUnit = item.kgFactor * SYRUP_RATIO;
            const rawUnits = Math.max(0, Math.round(allocatedKg / syrupNeededPerUnit));

            // Ensure minimum covers net order demand
            const effectiveUnits = Math.max(rawUnits, item.netOrderNeedUnits);

            // Round UP to complete boxes (packSize)
            const ps = item.packSize;
            let boxRoundedUnits = ps > 1 ? Math.ceil(effectiveUnits / ps) * ps : effectiveUnits;

            // For 350GR Liquipops: add 1 contramuestra per box-rounded batch
            const is350 = item.sizeValue <= 400 && item.sizeValue >= 300;
            if (is350 && boxRoundedUnits > 0) {
                boxRoundedUnits += 1; // contramuestra
            }

            rawAllocations.push({
                ...item,
                rawUnits,
                boxRoundedUnits,
                is350
            });
        });

        // === Build final mix ===
        const finalMix = rawAllocations.map(item => ({
            productId: item.product.id,
            sku: item.product.sku,
            name: item.product.name,
            sizeLabel: `${Math.round(item.kgFactor * 1000) / 1000} Kg`,
            kgFactor: Math.round(item.kgFactor * 1000) / 1000,
            packSize: item.packSize,
            plannedUnits: item.boxRoundedUnits,
            plannedWeightKg: Math.round(item.boxRoundedUnits * item.kgFactor * 100) / 100,
            orderDemandUnits: item.orderDemandUnits,
            boxes: item.packSize > 1 ? Math.floor(item.boxRoundedUnits / item.packSize) : null,
            contramuestra: item.is350 ? 1 : 0
        }));

        const totalPlannedKg = finalMix.reduce((acc, curr) => acc + curr.plannedWeightKg, 0);

        // Note: totalPlannedKg is PRODUCT weight, targetTotalKg is SYRUP weight.
        // Product weight naturally exceeds syrup weight (syrupRatio < 1). Don't inflate targetTotalKg.

        const syrupBatchesNeeded = Math.ceil(targetTotalKg / BATCH_SIZE);

        res.json({
            flavor,
            strategy,
            totalPlannedKg,
            totalSyrupKg: targetTotalKg,
            targetBatchCount: syrupBatchesNeeded,
            targetTotalKg,
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
        const ss = String(co.getSeconds()).padStart(2, '0');
        const flavorCode = (flavor || 'BATCH').toUpperCase().replace(/\s+/g, '-');
        const rnd = Math.random().toString(36).substring(2, 5).toUpperCase();
        const batchNumber = `${flavorCode}-${yy}${MM}${dd}-${hh}${mm}${ss}-${rnd}`;
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
        const { scheduledStart, scheduledEnd, status, notes, mix } = req.body;

        const updateData = {};
        if (scheduledStart) updateData.scheduledStart = new Date(scheduledStart);
        if (scheduledEnd) updateData.scheduledEnd = new Date(scheduledEnd);
        if (status) updateData.status = status;
        if (notes !== undefined) updateData.notes = notes;

        const batch = await prisma.productionBatch.update({
            where: { id },
            data: updateData
        });

        // Update outputTargets if mix is provided
        if (mix && Array.isArray(mix)) {
            for (const item of mix) {
                if (!item.productId) continue;
                await prisma.batchOutputTarget.updateMany({
                    where: { batchId: id, productId: item.productId },
                    data: {
                        plannedUnits: item.plannedUnits,
                        plannedWeightKg: item.plannedWeightKg || 0
                    }
                });
            }
        }

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
                OR: [
                    // Production batches for the active line
                    { outputTargets: { some: { product: { group: { name: groupName } } } } },
                    // Auxiliary events (LAVADO, PAUSA, etc.)
                    { flavor: { in: ['LAVADO', 'PAUSA ACTIVA', 'MANTENIMIENTO', 'REUNIÓN', 'REUNION'] } }
                ]
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

        await prisma.$transaction(async (tx) => {
            // 1. Find assembly note IDs for this batch
            const noteIds = (await tx.assemblyNote.findMany({
                where: { productionBatchId: id },
                select: { id: true }
            })).map(n => n.id);

            if (noteIds.length > 0) {
                // 2. Get lot consumptions to REVERT
                const consumptions = await tx.lotConsumption.findMany({
                    where: { assemblyNoteId: { in: noteIds } },
                    select: { materialLotId: true, quantityUsed: true,
                        materialLot: { select: { productId: true } }
                    }
                });

                // 3. Restore each materialLot and product stock
                for (const c of consumptions) {
                    if (c.materialLotId && c.quantityUsed > 0) {
                        await tx.materialLot.update({
                            where: { id: c.materialLotId },
                            data: { currentQuantity: { increment: c.quantityUsed } }
                        });
                    }
                    const productId = c.materialLot?.productId;
                    if (productId && c.quantityUsed > 0) {
                        await tx.product.update({
                            where: { id: productId },
                            data: { currentStock: { increment: c.quantityUsed } }
                        });
                    }
                }
                console.log(`[deleteBatch] Reverted ${consumptions.length} consumptions for batch ${id}`);

                // 4. Delete consumptions and notes
                await tx.lotConsumption.deleteMany({ where: { assemblyNoteId: { in: noteIds } } });
                await tx.assemblyNote.deleteMany({ where: { productionBatchId: id } });
            }

            // 5. Delete output targets and the batch
            await tx.batchOutputTarget.deleteMany({ where: { batchId: id } });
            await tx.productionBatch.delete({ where: { id } });
        });

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

        await prisma.$transaction(async (tx) => {
            // 1. Find all assembly note IDs for the batches
            const noteIds = (await tx.assemblyNote.findMany({
                where: { productionBatchId: { in: batchIds } },
                select: { id: true }
            })).map(n => n.id);

            if (noteIds.length > 0) {
                // 2. Get lot consumptions to REVERT
                const consumptions = await tx.lotConsumption.findMany({
                    where: { assemblyNoteId: { in: noteIds } },
                    select: { materialLotId: true, quantityUsed: true,
                        materialLot: { select: { productId: true } }
                    }
                });

                // 3. Restore each materialLot and product stock
                for (const c of consumptions) {
                    if (c.materialLotId && c.quantityUsed > 0) {
                        await tx.materialLot.update({
                            where: { id: c.materialLotId },
                            data: { currentQuantity: { increment: c.quantityUsed } }
                        });
                    }
                    const productId = c.materialLot?.productId;
                    if (productId && c.quantityUsed > 0) {
                        await tx.product.update({
                            where: { id: productId },
                            data: { currentStock: { increment: c.quantityUsed } }
                        });
                    }
                }
                console.log(`[deleteAllBatches] Reverted ${consumptions.length} consumptions for ${batchIds.length} batches`);

                // 4. Delete consumptions and notes
                await tx.lotConsumption.deleteMany({ where: { assemblyNoteId: { in: noteIds } } });
                await tx.assemblyNote.deleteMany({ where: { productionBatchId: { in: batchIds } } });
            }

            // 5. Delete output targets and batches
            await tx.batchOutputTarget.deleteMany({ where: { batchId: { in: batchIds } } });
            await tx.productionBatch.deleteMany({ where: { id: { in: batchIds } } });
        });

        res.json({ success: true, deleted: batchIds.length });
    } catch (error) {
        console.error("Error deleting all batches:", error);
        res.status(500).json({ error: 'Error deleting batches: ' + error.message });
    }
};

// NEW: Per-distributor demand + safety stock for a flavor
exports.getFlavorDemand = async (req, res) => {
    try {
        const flavor = req.query.flavor || req.params.flavor;
        const line = req.query.line || 'liquipops';
        const groupName = line === 'geniality' ? 'GENIALITY' : 'LIQUIPOPS';
        const DENSITY = line === 'geniality' ? 1.35 : 1.0;

        const products = await prisma.product.findMany({
            where: {
                group: { name: groupName },
                flavor: { equals: flavor, mode: 'insensitive' },
                active: true
            }
        });

        if (products.length === 0) return res.json({ distributors: [], safetyStock: [], sizeTotals: {} });

        const productIds = products.map(p => p.id);
        const productMap = {};
        products.forEach(p => {
            const sizeInfo = parseSize(p.name, DENSITY);
            productMap[p.id] = { ...p, sizeInfo };
        });

        // Pending order items with distributor info
        // Note: APPROVED orders set pendingQty=0 on approval, so we also check requestedQty > scanned
        const orderItems = await prisma.orderItem.findMany({
            where: {
                productId: { in: productIds },
                order: { status: { in: ['PENDING', 'APPROVED', 'IN_PICKING'] } }
            },
            include: {
                order: {
                    select: {
                        orderNumber: true,
                        status: true,
                        createdAt: true,
                        distributor: { select: { id: true, name: true } }
                    }
                },
                product: { select: { id: true, name: true } },
                pickingItems: { select: { scannedQty: true } }
            }
        });

        // Filter to only items that still need fulfillment
        const pendingItems = orderItems.filter(item => {
            const scanned = item.pickingItems?.reduce((s, pi) => s + pi.scannedQty, 0) || 0;
            const remaining = item.requestedQty - scanned;
            return remaining > 0;
        });

        // Group by distributor
        const distMap = {};
        pendingItems.forEach(item => {
            const dist = item.order.distributor;
            const distKey = dist.id;
            if (!distMap[distKey]) {
                distMap[distKey] = { distributorName: dist.name, items: [] };
            }
            const prod = productMap[item.productId];
            const sizeLabel = prod ? `${prod.sizeInfo.value}${prod.sizeInfo.unit === 'ML' ? 'ml' : prod.sizeInfo.unit}` : '?';
            const scanned = item.pickingItems?.reduce((s, pi) => s + pi.scannedQty, 0) || 0;
            const remaining = item.requestedQty - scanned;
            distMap[distKey].items.push({
                sizeLabel,
                qty: remaining
            });
        });

        // Flatten and aggregate per size per distributor
        const distributors = Object.values(distMap).map(d => {
            const sizeAgg = {};
            d.items.forEach(it => {
                if (!sizeAgg[it.sizeLabel]) sizeAgg[it.sizeLabel] = 0;
                sizeAgg[it.sizeLabel] += it.qty;
            });
            return {
                distributorName: d.distributorName,
                sizes: sizeAgg,
                totalUnits: d.items.reduce((a, it) => a + it.qty, 0)
            };
        }).sort((a, b) => b.totalUnits - a.totalUnits);

        // Per-size totals
        const sizeTotals = {};
        pendingItems.forEach(item => {
            const prod = productMap[item.productId];
            const sizeLabel = prod ? `${prod.sizeInfo.value}${prod.sizeInfo.unit === 'ML' ? 'ml' : prod.sizeInfo.unit}` : '?';
            const scanned = item.pickingItems?.reduce((s, pi) => s + pi.scannedQty, 0) || 0;
            const remaining = item.requestedQty - scanned;
            if (!sizeTotals[sizeLabel]) sizeTotals[sizeLabel] = 0;
            sizeTotals[sizeLabel] += remaining;
        });

        // Safety stock: 7 days per size — includes scheduled production
        // Get pending batch production for each product
        const pendingTargets = await prisma.batchOutputTarget.findMany({
            where: {
                productId: { in: productIds },
                batch: { status: { in: ['PENDING', 'STAGE_1_BASE', 'STAGE_2_JARABE', 'STAGE_3_ESFERIFICACION', 'STAGE_4_PRODUCTO_FINAL'] } }
            },
            select: { productId: true, plannedUnits: true }
        });
        const scheduledByProduct = {};
        pendingTargets.forEach(t => {
            scheduledByProduct[t.productId] = (scheduledByProduct[t.productId] || 0) + t.plannedUnits;
        });

        const safetyStock = products.map(p => {
            const sizeInfo = parseSize(p.name, DENSITY);
            const sizeLabel = `${sizeInfo.value}${sizeInfo.unit === 'ML' ? 'ml' : sizeInfo.unit}`;
            const dailyVelocity = p.dailyVelocity || 0;
            const need7d = Math.ceil(dailyVelocity * 7);
            const current = p.currentStock || 0;
            const scheduled = scheduledByProduct[p.id] || 0;
            const effectiveStock = current + scheduled;
            const deficit = Math.max(0, need7d - effectiveStock);
            return { sizeLabel, dailyVelocity: Math.round(dailyVelocity * 10) / 10, need7d, currentStock: current, scheduled, effectiveStock, deficit };
        }).sort((a, b) => (parseFloat(a.sizeLabel) || 0) - (parseFloat(b.sizeLabel) || 0));

        res.json({ flavor, distributors, sizeTotals, safetyStock });
    } catch (error) {
        console.error('Error fetching flavor demand:', error);
        res.status(500).json({ error: 'Error fetching demand' });
    }
};
