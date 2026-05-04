const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const configController = require('./configController');

const WATER_DENSITY_FLAVORS = ['LIQUIMON'];

// Helper: Parse size to Kg
// density: g/cm³ (= g/mL). Default 1.0 for water-like. Siropes use 1.35.
const parseSize = (name, density = 1.0) => {
    if (density > 1.0 && WATER_DENSITY_FLAVORS.some(f => name.toUpperCase().includes(f))) {
        density = 1.0;
    }
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
            syrupRatio: globalConfig.syrupRatio || 0.62,
            safetyStockDays: globalConfig.safetyStockDays || 2
        };

        // 1c. Fetch Order Deficit (full requestedQty, not remaining)
        // Siigo stock only decrements on invoice (DELIVERED), so picked-but-not-invoiced
        // items still count in currentStock. We must use full requestedQty as demand
        // to keep both sides of the equation consistent with Siigo.
        const productIds = products.map(p => p.id);
        const orderItemsForDeficit = await prisma.orderItem.findMany({
            where: {
                productId: { in: productIds },
                order: { status: { in: ['PENDING', 'APPROVED', 'IN_PICKING', 'READY'] } }
            },
            select: {
                productId: true,
                requestedQty: true,
            }
        });
        // Map: productId -> total demand units (full requestedQty)
        const orderDeficitMap = {};
        for (const item of orderItemsForDeficit) {
            if (item.requestedQty > 0) {
                orderDeficitMap[item.productId] = (orderDeficitMap[item.productId] || 0) + item.requestedQty;
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

                // USE GLOBAL STOCK (Include Maquilas + Production Zone)
                const totalProductStock = p.currentStock + (p.productionZoneStock || 0);
                const stockKg = totalProductStock * kgFactor;
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
                const velocity = p.dailyVelocity || 0;
                const need7d = Math.round(velocity * 7);
                stockDetails.push({
                    label,
                    units: totalProductStock,
                    kg: stockKg,
                    sizeWeight: kgFactor,
                    deficitUnits,
                    scheduledUnits: scheduledMap[p.id] || 0,
                    need7d,
                    dailyVelocity: Math.round(velocity * 10) / 10
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
            const hasMissingSize = items.some(p => (p.currentStock + (p.productionZoneStock || 0)) <= 0);
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

        // ── Detect if flavor uses BASE LIQUIPOPS DIOXIDO (different syrup ratio) ──
        let usesDioxido = false;
        if (line !== 'geniality') {
            const compuesto = await prisma.product.findFirst({
                where: { name: { equals: `COMPUESTO ${flavor}`, mode: 'insensitive' } }
            });
            if (compuesto) {
                const formula = await prisma.formula.findFirst({
                    where: { productId: compuesto.id, isActive: true },
                    include: { items: { include: { ingredient: { select: { name: true, sku: true } } } } }
                });
                usesDioxido = !!formula?.items?.some(i =>
                    i.ingredient?.name === 'BASE LIQUIPOPS DIOXIDO' || i.ingredient?.sku === 'PROCELIQUIPOPS54'
                );
            }
        }

        const config = line === 'geniality' ? {
            targetDays: globalConfig.geniality_targetDays || globalConfig.targetDays || 8,
            safetyStockDays: globalConfig.geniality_safetyStockDays || globalConfig.safetyStockDays || 2,
            syrupRatio: 1.0
        } : {
            targetDays: globalConfig.targetDays || 8,
            safetyStockDays: globalConfig.safetyStockDays || 2,
            syrupRatio: usesDioxido
                ? (globalConfig.syrupRatioDioxido || 0.81)
                : (globalConfig.syrupRatio || 0.62)
        };

        const TARGET_DAYS = config.targetDays;
        const SAFETY_DAYS = config.safetyStockDays;
        const SYRUP_RATIO = config.syrupRatio;
        const BATCH_SIZE = line === 'geniality' ? 100 : 120;
        const DENSITY = line === 'geniality' ? 1.35 : 1.0;

        // Fetch real order demand per product (full requestedQty)
        // Siigo stock includes picked-but-not-invoiced items, so demand must
        // use full requestedQty to stay consistent. Includes READY orders too.
        const productIds = products.map(p => p.id);
        const orderItemsRaw = await prisma.orderItem.findMany({
            where: {
                productId: { in: productIds },
                order: { status: { in: ['PENDING', 'APPROVED', 'IN_PICKING', 'READY'] } }
            },
            select: {
                productId: true,
                requestedQty: true,
            }
        });
        const orderDemandMap = {};
        orderItemsRaw.forEach(item => {
            if (item.requestedQty > 0) {
                orderDemandMap[item.productId] = (orderDemandMap[item.productId] || 0) + item.requestedQty;
            }
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
            const targetStock = velocity * (TARGET_DAYS + SAFETY_DAYS);
            const totalStock = p.currentStock + (p.productionZoneStock || 0);
            const orderDemand = orderDemandMap[p.id] || 0;
            const inProgress = inProgressMap[p.id] || 0;
            const effectiveStock = totalStock - orderDemand + inProgress;
            const deficit = Math.max(0, targetStock - effectiveStock);
            const deficitKg = deficit * sizeInfo.kgFactor * SYRUP_RATIO;

            const netOrderNeed = Math.max(0, orderDemand - Math.max(0, totalStock) - inProgress);

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
            if (sizeInfo.kgFactor) totalFlavorStock += ((p.currentStock + (p.productionZoneStock || 0)) * sizeInfo.kgFactor);
        });

        let boostedNeedKg = totalNeedKg;
        if (totalFlavorStock < 0) {
            boostedNeedKg += Math.abs(totalFlavorStock) * SYRUP_RATIO;
        }

        let targetTotalKg = Math.ceil(boostedNeedKg / BATCH_SIZE) * BATCH_SIZE;

        // === STEP 1: Calculate MINIMUM units per size (from order demand, pack-rounded) ===
        const rawAllocations = [];
        productNeeds.forEach(item => {
            const ps = item.packSize;
            const is350 = item.sizeValue <= 400 && item.sizeValue >= 300;
            let minUnits = ps > 1 ? Math.ceil(item.netOrderNeedUnits / ps) * ps : item.netOrderNeedUnits;
            if (is350 && line !== 'geniality') minUnits += 1; // contramuestra only for Liquipops
            rawAllocations.push({ ...item, minUnits, allocatedUnits: minUnits, is350 });
        });

        // === STEP 2: Calculate batch count ===
        let totalMinBaseKg = rawAllocations.reduce((s, i) => s + (i.allocatedUnits * i.kgFactor * SYRUP_RATIO), 0);
        let batchesNeeded = Math.max(1, Math.ceil(totalMinBaseKg / BATCH_SIZE));
        let velocityBatches = Math.ceil(boostedNeedKg / BATCH_SIZE);
        batchesNeeded = Math.max(batchesNeeded, velocityBatches);
        if (line === 'geniality') batchesNeeded = Math.min(7, batchesNeeded);
        // Round up to even — optimize water change cycles (2 batches per water change)
        if (batchesNeeded > 1 && batchesNeeded % 2 !== 0) batchesNeeded++;
        targetTotalKg = batchesNeeded * BATCH_SIZE;

        // Helper: build a mix entry object
        const buildEntry = (item, units, cm) => ({
            productId: item.product.id,
            sku: item.product.sku,
            name: item.product.name,
            sizeLabel: `${Math.round(item.kgFactor * 1000) / 1000} Kg`,
            kgFactor: Math.round(item.kgFactor * 1000) / 1000,
            packSize: item.packSize,
            plannedUnits: units,
            plannedWeightKg: Math.round(units * item.kgFactor * 100) / 100,
            orderDemandUnits: item.orderDemandUnits,
            boxes: item.packSize > 1 ? Math.round((units - cm) / item.packSize) : null,
            contramuestra: cm
        });

        if (line !== 'geniality') {
            // ═══════════════════════════════════════════════════════════════
            // LIQUIPOPS: Split batches by labeling group for efficiency
            // Group A: medium sizes (1150g) → own batches
            // Group B: large sizes (3400g) + small (350g) → combined batches
            // Each batch ALWAYS gets 1 contramuestra (350g)
            // ═══════════════════════════════════════════════════════════════
            const smallItem = rawAllocations.find(i => i.is350);
            const mediumItems = rawAllocations.filter(i => !i.is350 && i.sizeValue >= 500 && i.sizeValue < 2000);
            const largeItems = rawAllocations.filter(i => !i.is350 && i.sizeValue >= 2000);

            // If no large sizes, medium+small go together (no labeling split needed)
            const groupA = largeItems.length > 0 ? mediumItems : [];
            const groupB_nonSmall = largeItems.length > 0 ? largeItems : mediumItems;

            // Batch count per group based on DEFICIT (not just order demand)
            const groupADeficitKg = groupA.reduce((s, i) => s + i.deficitKg, 0);
            let groupABatches = groupADeficitKg > 0 ? Math.max(1, Math.ceil(groupADeficitKg / BATCH_SIZE)) : 0;

            const groupBLargeDeficitKg = groupB_nonSmall.reduce((s, i) => s + i.deficitKg, 0);
            const groupBSmallDeficitKg = smallItem ? smallItem.deficitKg : 0;
            const groupBDeficitKg = groupBLargeDeficitKg + groupBSmallDeficitKg;
            let groupBBatches = groupBDeficitKg > 0 ? Math.max(1, Math.ceil(groupBDeficitKg / BATCH_SIZE)) : 0;

            // Distribute extra batches PROPORTIONALLY between groups (not all to B)
            if (groupABatches + groupBBatches < batchesNeeded) {
                const extra = batchesNeeded - groupABatches - groupBBatches;
                const totalDef = groupADeficitKg + groupBDeficitKg;
                if (totalDef > 0) {
                    const extraA = Math.round(extra * groupADeficitKg / totalDef);
                    groupABatches += extraA;
                    groupBBatches += extra - extraA;
                } else {
                    groupABatches += Math.floor(extra / 2);
                    groupBBatches += Math.ceil(extra / 2);
                }
            }

            const suggestedBatches = [];

            // --- GROUP A: Medium-size batches (e.g. 1150g + contramuestra) ---
            // Track remaining deficit across batches
            const mediumDeficitLeft = {};
            groupA.forEach(item => { mediumDeficitLeft[item.product.id] = item.deficitUnits; });

            for (let b = 0; b < groupABatches; b++) {
                const mix = [];
                let baseKg = 0;
                const cmReserve = smallItem ? smallItem.kgFactor * SYRUP_RATIO : 0;
                const cap = BATCH_SIZE - cmReserve;
                const unitCounts = {};
                groupA.forEach(i => { unitCounts[i.product.id] = 0; });

                // PHASE 1: distribute by deficit
                for (const item of groupA) {
                    const packKg = item.packSize * item.kgFactor * SYRUP_RATIO;
                    let units = 0;
                    const maxUnits = Math.max(mediumDeficitLeft[item.product.id], item.minUnits);
                    while (baseKg + packKg <= cap + 0.5 && units < maxUnits) {
                        units += item.packSize;
                        baseKg += packKg;
                    }
                    mediumDeficitLeft[item.product.id] -= units;
                    unitCounts[item.product.id] += units;
                }
                // PHASE 2: FILL — never leave a half-empty batch. Use highest-velocity item to top up.
                const sortedByVelocity = [...groupA].sort((a, b2) => (b2.dailyVolumeKg || 0) - (a.dailyVolumeKg || 0));
                let topUp = true;
                while (topUp) {
                    topUp = false;
                    for (const item of sortedByVelocity) {
                        const packKg = item.packSize * item.kgFactor * SYRUP_RATIO;
                        if (baseKg + packKg <= cap + 0.5) {
                            unitCounts[item.product.id] += item.packSize;
                            baseKg += packKg;
                            topUp = true;
                            break;
                        }
                    }
                }
                // Build mix entries from unitCounts
                for (const item of groupA) {
                    if (unitCounts[item.product.id] > 0) {
                        mix.push(buildEntry(item, unitCounts[item.product.id], 0));
                    }
                }
                if (smallItem) mix.push(buildEntry(smallItem, 1, 1));

                suggestedBatches.push({
                    batchIndex: suggestedBatches.length + 1,
                    type: 'MEDIUM',
                    label: groupA.map(i => `${Math.round(i.sizeValue)}g`).join(' + '),
                    baseWeightKg: BATCH_SIZE,
                    mix
                });
            }

            // --- GROUP B: Large + Small batches (e.g. 3400g + 350g) ---
            // Track remaining deficit for large sizes across batches
            const largeDeficitLeft = {};
            groupB_nonSmall.forEach(item => { largeDeficitLeft[item.product.id] = item.deficitUnits; });

            // Proportional fill: calculate kg share for 3400g vs 350g based on deficit ratio
            const largeDefKg = groupB_nonSmall.reduce((s, i) => s + i.deficitKg, 0);
            const smallDefKg = smallItem ? smallItem.deficitKg : 0;
            const totalGroupBDefKg = largeDefKg + smallDefKg;
            const largeShareRatio = totalGroupBDefKg > 0 ? largeDefKg / totalGroupBDefKg : 0.7;

            let smallDeficitLeft = smallItem ? smallItem.deficitUnits : 0;

            for (let b = 0; b < groupBBatches; b++) {
                const mix = [];
                let baseKg = 0;

                // 1. Reserve 1 CM of 350g
                let smallUnits = 0;
                if (smallItem) {
                    smallUnits = 1;
                    baseKg += smallItem.kgFactor * SYRUP_RATIO;
                }

                const cmKg = baseKg;
                const availableKg = BATCH_SIZE - cmKg;
                const largeBudgetKg = availableKg * largeShareRatio;

                // 2. Fill large sizes up to their proportional budget
                const sorted = [...groupB_nonSmall].sort((a, b2) => (b2.dailyVolumeKg || 0) - (a.dailyVolumeKg || 0));
                const unitCounts = {};
                sorted.forEach(i => { unitCounts[i.product.id] = 0; });
                let largeKgUsed = 0;
                let filled = true;
                while (filled) {
                    filled = false;
                    for (const item of sorted) {
                        const remaining = largeDeficitLeft[item.product.id] - unitCounts[item.product.id];
                        if (remaining <= 0) continue;
                        const packKg = item.packSize * item.kgFactor * SYRUP_RATIO;
                        if (largeKgUsed + packKg <= largeBudgetKg + 0.5) {
                            unitCounts[item.product.id] += item.packSize;
                            largeKgUsed += packKg;
                            filled = true;
                        }
                    }
                }
                baseKg += largeKgUsed;
                sorted.forEach(i => { largeDeficitLeft[i.product.id] -= unitCounts[i.product.id]; });
                for (const item of sorted) {
                    if (unitCounts[item.product.id] > 0) {
                        mix.push(buildEntry(item, unitCounts[item.product.id], 0));
                    }
                }

                // 3. Fill 350g with remaining capacity (cajas cerradas, capped at deficit)
                if (smallItem && baseKg < BATCH_SIZE - 0.5) {
                    const packKg = smallItem.packSize * smallItem.kgFactor * SYRUP_RATIO;
                    while (baseKg + packKg <= BATCH_SIZE + 0.5 && smallDeficitLeft > 0) {
                        smallUnits += smallItem.packSize;
                        smallDeficitLeft -= smallItem.packSize;
                        baseKg += packKg;
                    }
                }
                if (smallItem) mix.push(buildEntry(smallItem, smallUnits, 1));

                // 4. If capacity remains, fill extra large sizes (beyond deficit, for balanced days)
                if (baseKg < BATCH_SIZE - 0.5) {
                    let extraFilled = true;
                    while (extraFilled) {
                        extraFilled = false;
                        for (const item of sorted) {
                            const packKg = item.packSize * item.kgFactor * SYRUP_RATIO;
                            if (baseKg + packKg <= BATCH_SIZE + 0.5) {
                                unitCounts[item.product.id] += item.packSize;
                                baseKg += packKg;
                                extraFilled = true;
                                const existing = mix.find(m => m.productId === item.product.id);
                                if (existing) {
                                    existing.plannedUnits += item.packSize;
                                    existing.boxes = Math.floor(existing.plannedUnits / (item.packSize || 1));
                                } else {
                                    mix.push(buildEntry(item, item.packSize, 0));
                                }
                            }
                        }
                    }
                }

                const bLabel = [...sorted.filter(i => unitCounts[i.product.id] > 0).map(i => `${Math.round(i.sizeValue)}g`), smallItem ? '350g' : ''].filter(Boolean).join(' + ');
                suggestedBatches.push({
                    batchIndex: suggestedBatches.length + 1,
                    type: 'LARGE_SMALL',
                    label: bLabel,
                    baseWeightKg: BATCH_SIZE,
                    mix
                });
            }

            // Ensure ALL sizes appear in every batch (with 0 units if not allocated)
            suggestedBatches.forEach(batch => {
                const presentIds = new Set(batch.mix.map(m => m.productId));
                rawAllocations.forEach(item => {
                    if (!presentIds.has(item.product.id)) {
                        batch.mix.push(buildEntry(item, 0, 0));
                    }
                });
            });

            // Also ensure aggregate mix includes all sizes
            const aggMap = {};
            suggestedBatches.forEach(batch => {
                batch.mix.forEach(item => {
                    if (!aggMap[item.productId]) {
                        aggMap[item.productId] = { ...item };
                    } else {
                        aggMap[item.productId].plannedUnits += item.plannedUnits;
                        aggMap[item.productId].plannedWeightKg += item.plannedWeightKg;
                        aggMap[item.productId].contramuestra += item.contramuestra;
                    }
                });
            });
            const finalMix = Object.values(aggMap).map(m => ({
                ...m,
                plannedWeightKg: Math.round(m.plannedWeightKg * 100) / 100,
                boxes: m.packSize > 1 ? Math.round((m.plannedUnits - m.contramuestra) / m.packSize) : null
            }));

            const totalPlannedKg = finalMix.reduce((a, m) => a + m.plannedWeightKg, 0);
            const totalBaseKg = Math.round(suggestedBatches.reduce((a, batch) =>
                a + batch.mix.reduce((s, m) => s + m.plannedUnits * m.kgFactor * SYRUP_RATIO, 0), 0));

            res.json({
                flavor,
                strategy: 'SPLIT_BY_LABELING',
                totalPlannedKg,
                totalBaseKg,
                totalSyrupKg: suggestedBatches.length * BATCH_SIZE,
                targetBatchCount: suggestedBatches.length,
                targetTotalKg: suggestedBatches.length * BATCH_SIZE,
                mix: finalMix,
                suggestedBatches
            });

        } else {
            // ═══════════════════════════════════════════════════════════════
            // GENIALITY: All sizes in one mix (old fill-to-batch logic)
            // ═══════════════════════════════════════════════════════════════
            let currentBaseKg = totalMinBaseKg;
            const capacityKg = targetTotalKg;
            const sortedForFill = [...rawAllocations].sort((a, b2) => (b2.dailyVolumeKg || 0) - (a.dailyVolumeKg || 0));
            let filled = true;
            while (currentBaseKg < capacityKg - 0.5 && filled) {
                filled = false;
                for (const item of sortedForFill) {
                    const ps = item.packSize || 1;
                    const packBaseKg = ps * item.kgFactor * SYRUP_RATIO;
                    if (currentBaseKg + packBaseKg <= capacityKg + 0.5) {
                        item.allocatedUnits += ps;
                        currentBaseKg += packBaseKg;
                        filled = true;
                    }
                }
            }

            const finalMix = rawAllocations.map(item => {
                return buildEntry(item, item.allocatedUnits, 0);
            });

            const totalPlannedKg = finalMix.reduce((acc, curr) => acc + curr.plannedWeightKg, 0);
            const totalBaseKg = Math.round(currentBaseKg);

            res.json({
                flavor,
                strategy: 'FILL_TO_BATCH',
                totalPlannedKg,
                totalBaseKg,
                totalSyrupKg: targetTotalKg,
                targetBatchCount: batchesNeeded,
                targetTotalKg,
                mix: finalMix
            });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error calculating mix' });
    }
};

exports.createBatch = async (req, res) => {
    console.log("DEBUG: createBatch called", req.body);
    const { flavor, scheduledStart, scheduledEnd, mix, baseWeight, batchIndex, totalBatches, notes } = req.body;
    try {
        const isGeniality = req.baseUrl?.includes('geniality') || req.path?.includes('geniality');
        const lineGroup = isGeniality ? 'GENIALITY' : 'LIQUIPOPS';

        // Backend = fuente de verdad para la duración del bache
        // Liquipops: ciclo completo del bache = BASE (marmita 30 min) + ESFERIFICACIÓN (tanque 60 min) = 90 min.
        // Con stagger de 60 min entre starts, esto reproduce la escalera (30 min de solape entre baches consecutivos),
        // que es lo que pasa en planta: bache 2 entra a marmita mientras bache 1 termina su esferificación en el tanque.
        // Geniality / AUX: usar lo que mande el cliente.
        let adjStart = new Date(scheduledStart);
        let adjEnd;
        if (!isGeniality && !AUX_FLAVORS.includes(flavor)) {
            const cfgRow0 = await prisma.systemSettings.findUnique({ where: { key: 'PRODUCTION_CONFIG' } });
            const cfg0 = cfgRow0?.value || {};
            const baseMin = cfg0.liquipops_baseDurationMin || LIQUIPOPS_BASE_DURATION_MIN;
            const sphericationMin = cfg0.liquipops_sphericationDurationMin || 60;
            const cycleMin = baseMin + sphericationMin; // 30 + 60 = 90 (escalera con stagger 60)
            adjEnd = new Date(adjStart.getTime() + cycleMin * 60000);
        } else {
            adjEnd = new Date(scheduledEnd);
        }
        const duration = adjEnd - adjStart;
        let searching = true;
        while (searching) {
            if (AUX_FLAVORS.includes(flavor)) { searching = false; break; }

            if (isGeniality) {
                // Geniality: sequential — check against ALL batches on the same line (including AUX)
                const conflict = await prisma.productionBatch.findFirst({
                    where: {
                        status: { notIn: ['COMPLETED', 'FAILED'] },
                        scheduledStart: { lt: adjEnd },
                        scheduledEnd: { gt: adjStart },
                        OR: [
                            { outputTargets: { some: { product: { group: { name: lineGroup } } } } },
                            { flavor: { in: AUX_FLAVORS } }
                        ]
                    },
                    orderBy: { scheduledEnd: 'desc' }
                });
                if (conflict) {
                    adjStart = new Date(conflict.scheduledEnd);
                    adjEnd = new Date(adjStart.getTime() + duration);
                } else {
                    searching = false;
                }
            } else {
                // Liquipops: stagger model — only check overlap against blocking AUX (not CAMBIO DE AGUA)
                // CAMBIO DE AGUA can coexist with batch prep (different equipment)
                const BLOCKING_AUX = AUX_FLAVORS.filter(f => f !== 'CAMBIO DE AGUA');
                const auxConflict = await prisma.productionBatch.findFirst({
                    where: {
                        status: { notIn: ['COMPLETED', 'FAILED'] },
                        flavor: { in: BLOCKING_AUX },
                        scheduledStart: { lt: adjEnd },
                        scheduledEnd: { gt: adjStart },
                    },
                    orderBy: { scheduledEnd: 'desc' }
                });
                if (auxConflict) {
                    adjStart = new Date(auxConflict.scheduledEnd);
                    adjEnd = new Date(adjStart.getTime() + duration);
                } else {
                    searching = false;
                }
            }
        }

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
                scheduledStart: adjStart,
                scheduledEnd: adjEnd,
                originalScheduledStart: adjStart,
                originalScheduledEnd: adjEnd,
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
        const { scheduledStart, scheduledEnd, status, notes, mix, baseWeight } = req.body;

        const updateData = {};
        if (scheduledStart) updateData.scheduledStart = new Date(scheduledStart);
        if (scheduledEnd) updateData.scheduledEnd = new Date(scheduledEnd);
        if (status) updateData.status = status;
        if (notes !== undefined) updateData.notes = notes;
        if (baseWeight !== undefined && baseWeight !== null && !Number.isNaN(Number(baseWeight))) {
            updateData.baseWeight = Number(baseWeight);
        }

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
            // If baseWeight wasn't explicitly sent, recompute it from updated outputTargets
            if (updateData.baseWeight === undefined) {
                const updatedTargets = await prisma.batchOutputTarget.findMany({
                    where: { batchId: id },
                    select: { plannedWeightKg: true }
                });
                const totalKg = updatedTargets.reduce((acc, t) => acc + (t.plannedWeightKg || 0), 0);
                if (totalKg > 0) updateData.baseWeight = totalKg;
            }
        }

        const batch = await prisma.productionBatch.update({
            where: { id },
            data: updateData
        });

        // Recompute projectedTotalWeight too if outputTargets changed
        if (mix && Array.isArray(mix)) {
            const updatedTargets = await prisma.batchOutputTarget.findMany({
                where: { batchId: id },
                select: { plannedWeightKg: true }
            });
            const totalOutput = updatedTargets.reduce((acc, t) => acc + (t.plannedWeightKg || 0), 0);
            await prisma.productionBatch.update({
                where: { id },
                data: { projectedTotalWeight: totalOutput }
            });
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

        // Use date range from query params; fallback to 14 days back + 30 days ahead
        const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        const to = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        const groupFilter = [
            { outputTargets: { some: { product: { group: { name: groupName } } } } },
            { flavor: { in: ['LAVADO', 'PAUSA ACTIVA', 'MANTENIMIENTO', 'REUNIÓN', 'REUNION', 'CAMBIO DE AGUA'] } }
        ];

        const batches = await prisma.productionBatch.findMany({
            where: {
                scheduledStart: { gte: from, lte: to },
                OR: groupFilter,
            },
            include: {
                outputTargets: {
                    include: { product: true }
                }
            }
        });

        // Numeración X/Y por BLOQUE DE PROGRAMACIÓN, no por rango visible:
        // un "bloque" = baches del mismo flavor creados juntos en una sola sesión (createdAt cercano).
        // Esto permite que aunque uno se complete, el operario siga viendo "1/6 .. 6/6" del bloque
        // original, y si programa otro bloque distinto la próxima semana, ése tendrá su propio X/Y.
        //
        // Para esto necesitamos consultar TODOS los baches del mismo flavor (incluyendo los fuera
        // del rango visible) en una ventana razonable (últimos 60 días) para reconstruir el bloque.
        const BATCH_GROUP_GAP_MIN = 10; // baches creados con < 10 min de diferencia son del mismo bloque
        const BATCH_LOOKBACK_DAYS = 60;
        const lookbackDate = new Date(Date.now() - BATCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

        // Recolectar flavors únicos NO-AUX dentro del rango visible
        const visibleFlavors = [...new Set(
            batches
                .filter(b => !AUX_FLAVORS.includes(b.flavor) && b.status !== 'FAILED')
                .map(b => b.flavor)
        )];

        // Traer TODOS los baches de esos flavors (incluyendo COMPLETED, fuera del rango visible)
        // para poder reconstruir los bloques de programación correctamente.
        const allFlavorBatches = visibleFlavors.length > 0 ? await prisma.productionBatch.findMany({
            where: {
                flavor: { in: visibleFlavors },
                status: { not: 'FAILED' },
                createdAt: { gte: lookbackDate },
                OR: groupFilter,
            },
            select: { id: true, flavor: true, createdAt: true, originalScheduledStart: true, scheduledStart: true }
        }) : [];

        // Agrupar por flavor + bloque de createdAt cercano
        const batchIndex = {}; // batchId → "X/Y"
        const flavorGroups = {}; // flavor → array de bloques [[batch, batch], [batch, batch...]]
        for (const flavor of visibleFlavors) {
            const ofFlavor = allFlavorBatches
                .filter(b => b.flavor === flavor)
                .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

            const blocks = [];
            let currentBlock = [];
            let lastCreatedAt = null;
            for (const b of ofFlavor) {
                const createdAt = new Date(b.createdAt);
                if (!lastCreatedAt || (createdAt - lastCreatedAt) <= BATCH_GROUP_GAP_MIN * 60000) {
                    currentBlock.push(b);
                } else {
                    if (currentBlock.length > 0) blocks.push(currentBlock);
                    currentBlock = [b];
                }
                lastCreatedAt = createdAt;
            }
            if (currentBlock.length > 0) blocks.push(currentBlock);
            flavorGroups[flavor] = blocks;

            // Para cada bloque, ordenar internamente por originalScheduledStart y asignar X/Y
            for (const block of blocks) {
                const sortedBlock = [...block].sort((a, b) => {
                    const aRef = new Date(a.originalScheduledStart || a.scheduledStart);
                    const bRef = new Date(b.originalScheduledStart || b.scheduledStart);
                    return aRef - bRef;
                });
                const total = sortedBlock.length;
                sortedBlock.forEach((b, i) => {
                    batchIndex[b.id] = `${i + 1}/${total}`;
                });
            }
        }

        const events = batches.map(b => {
            // Detect line from group: if any output target is in GENIALITY group, use sirope density
            const isGenialityBatch = b.outputTargets.some(t => t.product?.group?.name === 'GENIALITY' || t.product?.name?.includes('SIROPE'));
            const batchDensity = isGenialityBatch ? 1.35 : 1.0;
            const idx = batchIndex[b.id];
            const titleNum = idx ? ` ${idx}` : '';

            // For ingredient-style batches (no size pattern in product name),
            // derive kgFactor from baseWeight/plannedUnits so the modal can
            // recompute weights correctly when the user changes units.
            const totalUnits = b.outputTargets.reduce((acc, t) => acc + (t.plannedUnits || 0), 0);

            return {
                id: b.id,
                title: `${b.flavor}${titleNum} (${Math.round(b.baseWeight || 0)}kg)`,
                start: b.scheduledStart,
                end: b.scheduledEnd,
                flavor: b.flavor,
                status: b.status,
                baseWeight: b.baseWeight, // Exposed for frontend calculations
                notes: b.notes, // Include notes for auxiliary events
                mix: b.outputTargets.map(t => {
                    const sizeInfo = parseSize(t.product.name, batchDensity);
                    let kgFactor = sizeInfo.kgFactor;
                    // Fallback for ingredients (no "X NN GR/KG/ML" pattern):
                    // derive factor from total batch weight / total units.
                    if ((!kgFactor || kgFactor === 0) && b.baseWeight && totalUnits > 0) {
                        kgFactor = b.baseWeight / totalUnits;
                    }
                    return {
                        id: t.productId,
                        productId: t.productId,  // Frontend launch uses this field
                        name: t.product.name,
                        sku: t.product.sku,
                        plannedUnits: t.plannedUnits,
                        plannedWeightKg: t.plannedWeightKg,
                        packSize: t.product.packSize || 1,
                        sizeLabel: `${Math.round(kgFactor * 1000) / 1000} Kg`,
                        kgFactor: Math.round(kgFactor * 1000) / 1000
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

// Endpoint nuevo para los metadatos operativos + capacidad teórica diaria
exports.getOperationalMeta = async (_req, res) => {
    try {
        const cfgRow = await prisma.systemSettings.findUnique({ where: { key: 'PRODUCTION_CONFIG' } });
        const cfgVal = cfgRow?.value || {};
        const baseDur = cfgVal.liquipops_baseDurationMin || LIQUIPOPS_BASE_DURATION_MIN;
        const alginatoDur = cfgVal.liquipops_alginatoDurationMin || ALGINATO_DURATION_MIN;
        const alginatoEveryN = cfgVal.liquipops_alginatoEveryN || ALGINATO_EVERY_N_BATCHES;
        const sphericationDur = cfgVal.liquipops_sphericationDurationMin || 60;
        const lavadoDur = 60;
        const handoverMin = 20;

        // Capacidad teórica de un turno de 8h = 480 min:
        // - 20 min entrega de turno (no productivos)
        // - cada N baches: +60 min lavado + 35 min alginato = 95 min adicionales
        // - cada bache ocupa el tanque 60 min (esferificación)
        // - cambio de sabor descuenta 60 min (LAVADO marmita)
        const SHIFT_MIN = 8 * 60;
        const usableMin = SHIFT_MIN - handoverMin;
        // batches por turno asumiendo MISMO sabor:
        //   N baches consecutivos cuestan: N*60 + floor(N/everyN)*(lavadoDur + alginatoDur)
        let batchesPerShift = 0;
        for (let n = 1; n <= 20; n++) {
            const cost = n * sphericationDur + Math.floor(n / alginatoEveryN) * (lavadoDur + alginatoDur);
            if (cost <= usableMin) batchesPerShift = n; else break;
        }
        const batchesPerDay = batchesPerShift * 3;

        res.json({
            handoverWindows: cfgVal.liquipops_handoverWindows || SHIFT_HANDOVER_WINDOWS,
            alginatoEveryN,
            baseDurationMin: baseDur,
            alginatoDurationMin: alginatoDur,
            sphericationDurationMin: sphericationDur,
            lavadoDurationMin: lavadoDur,
            handoverMin,
            capacity: {
                batchesPerShift,
                batchesPerDay,
                shiftMinutes: SHIFT_MIN,
                usableMinutes: usableMin,
                note: `Teórico mismo sabor: ${batchesPerShift} baches/turno × 3 turnos = ${batchesPerDay}/día. Cambio de sabor resta 60 min (LAVADO marmita).`,
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching operational meta' });
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

        // Order items with distributor info (includes READY - picked but not invoiced)
        const orderItems = await prisma.orderItem.findMany({
            where: {
                productId: { in: productIds },
                order: { status: { in: ['PENDING', 'APPROVED', 'IN_PICKING', 'READY'] } }
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

        // All items from active orders count as demand (full requestedQty)
        const pendingItems = orderItems.filter(item => item.requestedQty > 0);

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
            distMap[distKey].items.push({
                sizeLabel,
                qty: item.requestedQty
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

        // Per-size totals (full requestedQty to stay consistent with Siigo stock)
        const sizeTotals = {};
        pendingItems.forEach(item => {
            const prod = productMap[item.productId];
            const sizeLabel = prod ? `${prod.sizeInfo.value}${prod.sizeInfo.unit === 'ML' ? 'ml' : prod.sizeInfo.unit}` : '?';
            if (!sizeTotals[sizeLabel]) sizeTotals[sizeLabel] = 0;
            sizeTotals[sizeLabel] += item.requestedQty;
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
            const current = (p.currentStock || 0) + (p.productionZoneStock || 0);
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

// ── Reschedule pending batches at shift change ──────────────────────────────
const SHIFT_HOURS = [6, 14, 22]; // Colombia hours
const COLOMBIA_OFFSET = -5;

const reschedulePendingForShift = async (line, shiftStartHour) => {
    const now = new Date();
    const colombiaHour = (now.getUTCHours() + COLOMBIA_OFFSET + 24) % 24;

    if (!shiftStartHour) {
        shiftStartHour = SHIFT_HOURS.reduce((closest, h) =>
            Math.abs(colombiaHour - h) < Math.abs(colombiaHour - closest) ? h : closest
        , SHIFT_HOURS[0]);
    }

    const shiftStartUTC = new Date(now);
    shiftStartUTC.setUTCHours(shiftStartHour - COLOMBIA_OFFSET, 0, 0, 0);
    if (shiftStartUTC > new Date(now.getTime() + 60 * 60000)) {
        shiftStartUTC.setUTCDate(shiftStartUTC.getUTCDate() - 1);
    }

    const guardKey = `LAST_SHIFT_RESCHEDULE_${line}`;
    const lastRun = await prisma.systemSettings.findUnique({ where: { key: guardKey } });
    if (lastRun?.value?.shiftStart === shiftStartUTC.toISOString()) {
        return { rescheduled: 0, message: 'Already rescheduled for this shift' };
    }

    const config = await prisma.systemSettings.findUnique({ where: { key: 'PRODUCTION_CONFIG' } });
    const cfg = config?.value || {};
    const standardDurationMin = line === 'geniality'
        ? (cfg.geniality_batchDuration || 240)
        : (cfg.batchDuration || 90);

    const AUX_DURATIONS = { 'CAMBIO DE AGUA': 30, 'LAVADO': 60, 'PAUSA ACTIVA': 15, 'MANTENIMIENTO': 60, 'REUNIÓN': 30, 'REUNION': 30, 'ALGINATO': 35, 'BASE': 30 };

    const groupName = line === 'geniality' ? 'GENIALITY' : 'LIQUIPOPS';
    const auxFlavors = ['LAVADO', 'PAUSA ACTIVA', 'MANTENIMIENTO', 'REUNIÓN', 'REUNION', 'CAMBIO DE AGUA', 'ALGINATO', 'BASE'];

    const lineBatches = await prisma.productionBatch.findMany({
        where: {
            status: { notIn: ['COMPLETED', 'FAILED'] },
            outputTargets: { some: { product: { group: { name: groupName } } } }
        },
        select: { scheduledStart: true, scheduledEnd: true },
        orderBy: { scheduledStart: 'asc' }
    });
    const lineStart = lineBatches.length > 0 ? lineBatches[0].scheduledStart : null;
    const lineEnd = lineBatches.length > 0 ? lineBatches[lineBatches.length - 1].scheduledEnd : null;

    const allBatches = await prisma.productionBatch.findMany({
        where: {
            status: { notIn: ['COMPLETED', 'FAILED'] },
            OR: [
                { outputTargets: { some: { product: { group: { name: groupName } } } } },
                ...(lineStart && lineEnd ? [{
                    flavor: { in: auxFlavors },
                    scheduledStart: { gte: lineStart },
                    scheduledEnd: { lte: new Date(new Date(lineEnd).getTime() + 24 * 60 * 60000) }
                }] : [])
            ]
        },
        include: {
            assemblyNotes: { select: { startedAt: true, status: true } }
        },
        orderBy: { scheduledStart: 'asc' }
    });

    const runningBatches = allBatches.filter(b =>
        b.assemblyNotes.some(n => n.startedAt || n.status === 'EXECUTING')
    );
    const pendingBatches = allBatches.filter(b =>
        !b.assemblyNotes.some(n => n.startedAt || n.status === 'EXECUTING') &&
        b.scheduledStart
    );

    if (pendingBatches.length === 0) {
        return { rescheduled: 0, message: 'No pending batches to reschedule' };
    }

    let effectiveStart = new Date(shiftStartUTC);

    if (runningBatches.length > 0) {
        const latestEnd = runningBatches.reduce((max, b) => {
            const realStartedAt = b.assemblyNotes.find(n => n.startedAt)?.startedAt || b.startedAt;
            const isAux = auxFlavors.includes(b.flavor);
            const batchDurMs = isAux ? (AUX_DURATIONS[b.flavor] || 30) * 60000 : standardDurationMin * 60000;
            const end = realStartedAt
                ? new Date(new Date(realStartedAt).getTime() + batchDurMs)
                : (b.scheduledEnd ? new Date(b.scheduledEnd) : new Date(now.getTime() + batchDurMs));
            return end > max ? end : max;
        }, new Date(0));
        if (latestEnd > effectiveStart) {
            effectiveStart = new Date(latestEnd);
        }
    }

    const results = [];
    let cursor = new Date(effectiveStart);

    for (const batch of pendingBatches) {
        const oldStart = batch.scheduledStart;
        const oldEnd = batch.scheduledEnd;
        const isAux = auxFlavors.includes(batch.flavor);
        const durationMs = isAux
            ? (AUX_DURATIONS[batch.flavor] || 30) * 60000
            : standardDurationMin * 60000;

        const newStart = new Date(cursor);
        const newEnd = new Date(cursor.getTime() + durationMs);

        await prisma.productionBatch.update({
            where: { id: batch.id },
            data: { scheduledStart: newStart, scheduledEnd: newEnd }
        });

        results.push({
            id: batch.id,
            batchNumber: batch.batchNumber,
            flavor: batch.flavor,
            oldStart,
            newStart,
            newEnd
        });

        cursor = new Date(newEnd);
    }

    await prisma.systemSettings.upsert({
        where: { key: guardKey },
        create: { key: guardKey, value: { line, shiftStart: shiftStartUTC.toISOString(), rescheduledAt: now.toISOString(), batchesMoved: results.length } },
        update: { value: { line, shiftStart: shiftStartUTC.toISOString(), rescheduledAt: now.toISOString(), batchesMoved: results.length } }
    });

    const runningInfo = runningBatches.length > 0 ? runningBatches[0].batchNumber : null;

    return {
        rescheduled: results.length,
        shiftStart: shiftStartUTC,
        effectiveStart,
        runningBatch: runningInfo,
        batches: results
    };
};

exports.rescheduleShift = async (req, res) => {
    try {
        const line = req.params.line || 'liquipops';
        const { shiftStartHour } = req.body || {};
        const result = await reschedulePendingForShift(line, shiftStartHour);
        res.json(result);
    } catch (error) {
        console.error('Error rescheduling shift:', error);
        res.status(500).json({ error: 'Error rescheduling', detail: error.message });
    }
};

exports._reschedulePendingForShift = reschedulePendingForShift;

// ── Reschedule pending batches after a batch is started ──────────────────────
const AUX_FLAVORS = ['LAVADO', 'PAUSA ACTIVA', 'MANTENIMIENTO', 'REUNIÓN', 'REUNION', 'CAMBIO DE AGUA', 'ALGINATO', 'BASE'];
const AUX_DUR = { 'CAMBIO DE AGUA': 30, 'LAVADO': 60, 'PAUSA ACTIVA': 15, 'MANTENIMIENTO': 60, 'REUNIÓN': 30, 'REUNION': 30, 'ALGINATO': 35, 'BASE': 30 };

// ── Modelo operativo Liquipops (FASE 1) ─────────────────────────────────────
const LIQUIPOPS_BASE_DURATION_MIN = 30;
const ALGINATO_DURATION_MIN = 35;
const ALGINATO_EVERY_N_BATCHES = 3;
const SHIFT_HANDOVER_WINDOWS = [
    { startH: 6,  startM: 0, endH: 6,  endM: 20, label: 'Entrega turno mañana' },
    { startH: 14, startM: 0, endH: 14, endM: 20, label: 'Entrega turno tarde' },
    { startH: 22, startM: 0, endH: 22, endM: 20, label: 'Entrega turno noche' },
];

// Cuenta baches Liquipops FINALES consecutivos terminando antes de refTime
// (sin saltar a otra cadena, sin contar AUX). Misma lógica que ProductionScheduler.jsx:1050-1063.
const countConsecutiveFinalBatches = async (refTime) => {
    const MAX_SESSION_GAP_MS = 3 * 60 * 60 * 1000;
    const prior = await prisma.productionBatch.findMany({
        where: {
            scheduledEnd: { lte: refTime },
            status: { notIn: ['COMPLETED', 'FAILED'] },
            flavor: { notIn: AUX_FLAVORS },
        },
        orderBy: { scheduledEnd: 'desc' },
        take: 30,
    });
    let count = 0;
    let lastStart = refTime;
    for (const b of prior) {
        const evEnd = new Date(b.scheduledEnd);
        if ((lastStart - evEnd) > MAX_SESSION_GAP_MS) break;
        count++;
        lastStart = new Date(b.scheduledStart);
    }
    return count;
};

// Devuelve el último bache Liquipops FINAL antes de refTime (mismo grupo de cadena)
const getLastFinalBatchBefore = async (refTime) => {
    return prisma.productionBatch.findFirst({
        where: {
            scheduledEnd: { lte: refTime },
            status: { notIn: ['COMPLETED', 'FAILED'] },
            flavor: { notIn: AUX_FLAVORS },
        },
        orderBy: { scheduledEnd: 'desc' },
    });
};

// Crea un evento AUX simple sin outputTargets ni mix
const createAuxEvent = async (flavor, scheduledStart, scheduledEnd, notes) => {
    const yy = String(new Date().getFullYear()).slice(-2);
    const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
    const ts = scheduledStart.toISOString().replace(/[^0-9]/g, '').slice(2, 12);
    return prisma.productionBatch.create({
        data: {
            batchNumber: `${flavor.replace(/\s+/g, '-')}-${ts}-${rnd}`,
            flavor,
            scheduledStart,
            scheduledEnd,
            originalScheduledStart: scheduledStart,
            originalScheduledEnd: scheduledEnd,
            status: 'PENDING',
            notes: notes || null,
        },
    });
};

const rescheduleAfterBatchStart = async (batchId, line) => {
    const config = await prisma.systemSettings.findUnique({ where: { key: 'PRODUCTION_CONFIG' } });
    const cfg = config?.value || {};
    const standardDurationMin = line === 'geniality'
        ? (cfg.geniality_batchDuration || 240)
        : (cfg.batchDuration || 90);

    const startedBatch = await prisma.productionBatch.findUnique({
        where: { id: batchId },
        select: { id: true, startedAt: true, flavor: true, scheduledStart: true }
    });
    if (!startedBatch?.startedAt) return { rescheduled: 0 };

    const isAuxStarted = AUX_FLAVORS.includes(startedBatch.flavor);
    const startedDurMs = isAuxStarted
        ? (AUX_DUR[startedBatch.flavor] || 30) * 60000
        : standardDurationMin * 60000;
    const realStart = new Date(startedBatch.startedAt);
    const estimatedEnd = new Date(realStart.getTime() + startedDurMs);

    await prisma.productionBatch.update({
        where: { id: batchId },
        data: {
            scheduledStart: realStart,
            scheduledEnd: estimatedEnd,
        }
    });

    // Liquipops: COLA COMPACTA — un solo tanque físico = una sola cola para todos los sabores.
    // Cuando un bache se inicia (en su hora o tarde), realineamos TODOS los pending consecutivos
    // arrancando justo después del bache iniciado, con stagger de 60 min (ESCALERA).
    // Esto evita solapes entre cadenas de distintos sabores y mantiene la "escalera" del cuello de botella.
    if (line !== 'geniality') {
        const STAGGER_MS = 60 * 60000; // 60 min entre starts (escalera)

        // Cursor inicial = scheduledStart del bache que se acaba de iniciar (realStart).
        // Los siguientes baches arrancan en cursor + STAGGER, cursor + 2*STAGGER, etc.
        let cursor = realStart.getTime();

        const allPending = await prisma.productionBatch.findMany({
            where: {
                id: { not: batchId },
                status: 'PENDING',
                startedAt: null,
                completedAt: null,
                flavor: { notIn: AUX_FLAVORS }, // solo baches finales (los AUX se manejan aparte)
                outputTargets: { some: { product: { group: { name: 'LIQUIPOPS' } } } }
            },
            select: { id: true, flavor: true, scheduledStart: true, scheduledEnd: true, originalScheduledStart: true, batchNumber: true },
            orderBy: [{ originalScheduledStart: 'asc' }, { scheduledStart: 'asc' }]
        });

        if (allPending.length === 0) return { rescheduled: 0, estimatedEnd };

        const results = [];

        for (const batch of allPending) {
            cursor += STAGGER_MS;
            const newStart = new Date(cursor);
            const dur = batch.scheduledEnd && batch.scheduledStart
                ? new Date(batch.scheduledEnd).getTime() - new Date(batch.scheduledStart).getTime()
                : standardDurationMin * 60000;
            const newEnd = new Date(newStart.getTime() + dur);
            await prisma.productionBatch.update({
                where: { id: batch.id },
                data: { scheduledStart: newStart, scheduledEnd: newEnd }
            });
            results.push({ id: batch.id, flavor: batch.flavor, newStart, newEnd });
        }

        // Cleanup: if the last item in queue is a CAMBIO DE AGUA, remove it (no batch follows)
        const finalQueue = await prisma.productionBatch.findMany({
            where: {
                status: 'PENDING',
                OR: [
                    { outputTargets: { some: { product: { group: { name: 'LIQUIPOPS' } } } } },
                    { flavor: { in: AUX_FLAVORS } }
                ]
            },
            orderBy: { scheduledStart: 'desc' },
            take: 1,
            select: { id: true, flavor: true }
        });
        if (finalQueue[0]?.flavor === 'CAMBIO DE AGUA') {
            await prisma.productionBatch.delete({ where: { id: finalQueue[0].id } });
            console.log(`[reschedule] Removed trailing CAMBIO DE AGUA (no batch follows)`);
        }

        console.log(`[reschedule] Liquipops cola compacta: ${results.length} baches reposicionados desde ${realStart.toISOString().slice(11,16)}.`);
        return { rescheduled: results.length, estimatedEnd };
    }

    // Geniality: sequential — reposition all pending batches after the started one
    const groupName = 'GENIALITY';
    const INGREDIENT_SKUS = ['PROCELIQUIPOPS26', 'PROCELIQUIPOPS43'];

    const groupFilter = { OR: [
        { outputTargets: { some: { product: { group: { name: groupName } } } } },
        { outputTargets: { some: { product: { sku: { in: INGREDIENT_SKUS } } } } }
    ] };

    const lineBatches = await prisma.productionBatch.findMany({
        where: {
            status: { notIn: ['COMPLETED', 'FAILED'] },
            ...groupFilter
        },
        select: { scheduledStart: true, scheduledEnd: true },
        orderBy: { scheduledStart: 'asc' }
    });
    const lineStart = lineBatches[0]?.scheduledStart || null;

    const allBatches = await prisma.productionBatch.findMany({
        where: {
            status: { notIn: ['COMPLETED', 'FAILED'] },
            OR: [
                { outputTargets: { some: { product: { group: { name: groupName } } } } },
                { outputTargets: { some: { product: { sku: { in: INGREDIENT_SKUS } } } } },
                { flavor: { in: AUX_FLAVORS }, scheduledStart: { gte: lineStart || new Date() } }
            ]
        },
        include: { assemblyNotes: { select: { startedAt: true, status: true } } },
        orderBy: { scheduledStart: 'asc' }
    });

    // Find the latest scheduledEnd among all ACTIVE (non-pending, non-completed, non-aux) batches
    const activeBatches = allBatches.filter(b =>
        !AUX_FLAVORS.includes(b.flavor) &&
        b.scheduledEnd &&
        (b.startedAt || b.assemblyNotes.some(n => n.startedAt || n.status === 'EXECUTING')) &&
        !b.completedAt
    );
    const latestActiveEnd = activeBatches.reduce((max, b) => {
        const end = new Date(b.scheduledEnd);
        return end > max ? end : max;
    }, estimatedEnd);

    // Include ALL pending batches that overlap with active batches or come after them
    const earliestActiveStart = activeBatches.reduce((min, b) => {
        const s = new Date(b.scheduledStart);
        return s < min ? s : min;
    }, new Date(realStart));

    const pendingBatches = allBatches.filter(b =>
        b.id !== batchId &&
        !b.startedAt &&
        !b.completedAt &&
        !b.assemblyNotes.some(n => n.startedAt || n.status === 'EXECUTING') &&
        b.scheduledStart &&
        new Date(b.scheduledStart) >= earliestActiveStart
    );

    if (pendingBatches.length === 0) return { rescheduled: 0 };

    let cursor = new Date(latestActiveEnd);
    const results = [];

    for (const batch of pendingBatches) {
        const isAux = AUX_FLAVORS.includes(batch.flavor);
        const durationMs = isAux
            ? (AUX_DUR[batch.flavor] || 30) * 60000
            : standardDurationMin * 60000;

        let newStart = new Date(cursor);
        let newEnd = new Date(cursor.getTime() + durationMs);

        // Skip over any active batch that occupies this slot
        let shifted = true;
        while (shifted) {
            shifted = false;
            for (const a of activeBatches) {
                if (newStart < new Date(a.scheduledEnd) && newEnd > new Date(a.scheduledStart)) {
                    newStart = new Date(a.scheduledEnd);
                    newEnd = new Date(newStart.getTime() + durationMs);
                    shifted = true;
                    break;
                }
            }
        }

        if (newStart.getTime() === new Date(batch.scheduledStart).getTime()) {
            cursor = new Date(newEnd);
            continue;
        }

        await prisma.productionBatch.update({
            where: { id: batch.id },
            data: { scheduledStart: newStart, scheduledEnd: newEnd }
        });

        results.push({ id: batch.id, flavor: batch.flavor, newStart, newEnd });
        cursor = new Date(newEnd);
    }

    return { rescheduled: results.length, estimatedEnd, batches: results };
};

exports.rescheduleAfterBatchStart = rescheduleAfterBatchStart;

// ── Start/Finish auxiliary event (CAMBIO DE AGUA, etc.) ──────────────────────
exports.auxAction = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body; // 'start' or 'finish'
        const userId = req.user?.id;
        const userName = req.user?.name || req.user?.email || 'Operario';

        const batch = await prisma.productionBatch.findUnique({ where: { id } });
        if (!batch) return res.status(404).json({ error: 'Bache no encontrado' });

        if (action === 'start') {
            const now = new Date();
            const isFalla = batch.flavor === 'FALLA';
            // FALLA has indefinite duration — placeholder of 1 minute, real end set on finish
            const auxDuration = isFalla ? 60000 : (AUX_DUR[batch.flavor] || 30) * 60000;
            const updated = await prisma.productionBatch.update({
                where: { id },
                data: {
                    startedAt: now,
                    scheduledStart: now,
                    scheduledEnd: new Date(now.getTime() + auxDuration),
                    status: 'STAGE_1_BASE',
                    notes: batch.notes
                        ? `${batch.notes} | Iniciado por: ${userName}`
                        : `Iniciado por: ${userName}`,
                }
            });

            return res.json({ ...updated, action: 'started' });
        }

        if (action === 'finish') {
            const now = new Date();
            const isFalla = batch.flavor === 'FALLA';
            const realDurationMs = batch.startedAt ? now.getTime() - new Date(batch.startedAt).getTime() : 0;

            const updated = await prisma.productionBatch.update({
                where: { id },
                data: {
                    completedAt: now,
                    scheduledEnd: now,
                    status: 'COMPLETED',
                    notes: batch.notes
                        ? `${batch.notes} | Finalizado por: ${userName}${isFalla && realDurationMs > 60000 ? ` | Falla resuelta en ${Math.round(realDurationMs/60000)} min — cronograma desplazado` : ''}`
                        : `Finalizado por: ${userName}`,
                }
            });

            // FALLA: shift all PENDING batches that come after the failure start
            if (isFalla && realDurationMs > 60000) {
                const failureStart = new Date(batch.startedAt);
                const isGenialityFailure = (batch.notes || '').toLowerCase().includes('geniality');
                const lineGroup = isGenialityFailure ? 'GENIALITY' : 'LIQUIPOPS';

                const pendingBatches = await prisma.productionBatch.findMany({
                    where: {
                        id: { not: id },
                        status: 'PENDING',
                        startedAt: null,
                        scheduledStart: { gt: failureStart },
                        OR: [
                            { outputTargets: { some: { product: { group: { name: lineGroup } } } } },
                            { flavor: { in: AUX_FLAVORS } }
                        ]
                    },
                    select: { id: true, scheduledStart: true, scheduledEnd: true }
                });

                for (const b of pendingBatches) {
                    const newStart = new Date(new Date(b.scheduledStart).getTime() + realDurationMs);
                    const newEnd = b.scheduledEnd ? new Date(new Date(b.scheduledEnd).getTime() + realDurationMs) : null;
                    await prisma.productionBatch.update({
                        where: { id: b.id },
                        data: { scheduledStart: newStart, scheduledEnd: newEnd }
                    });
                }
                console.log(`[failure] Resolved in ${Math.round(realDurationMs/60000)} min — shifted ${pendingBatches.length} pending batches forward`);
            }

            return res.json({ ...updated, action: 'finished', durationMin: Math.round(realDurationMs/60000), shiftedBatches: isFalla ? 'see logs' : 0 });
        }

        if (action === 'execute') {
            const now = new Date();
            const updated = await prisma.productionBatch.update({
                where: { id },
                data: {
                    startedAt: now,
                    completedAt: now,
                    scheduledStart: now,
                    scheduledEnd: now,
                    status: 'COMPLETED',
                    notes: `Ejecutado por: ${userName}`,
                }
            });
            return res.json({ ...updated, action: 'executed' });
        }

        return res.status(400).json({ error: 'Acción inválida. Use "start", "finish" o "execute"' });
    } catch (error) {
        console.error('Error in auxAction:', error);
        res.status(500).json({ error: 'Error procesando acción auxiliar' });
    }
};

// ── Failure Statistics ──────────────────────────────────────────────────────
exports.failureStats = async (req, res) => {
    try {
        const { from, to } = req.query;
        const dateFrom = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const dateTo = to ? new Date(to) : new Date();

        const fallas = await prisma.productionBatch.findMany({
            where: {
                flavor: 'FALLA',
                status: 'COMPLETED',
                startedAt: { gte: dateFrom, lte: dateTo },
                completedAt: { not: null }
            },
            select: { id: true, startedAt: true, completedAt: true, notes: true },
            orderBy: { startedAt: 'desc' }
        });

        const totalFailures = fallas.length;
        let totalMs = 0;
        let longest = null;
        const byDayMap = {};

        for (const f of fallas) {
            const dur = new Date(f.completedAt).getTime() - new Date(f.startedAt).getTime();
            totalMs += dur;

            const durMin = Math.round(dur / 60000);
            if (!longest || dur > (new Date(longest.completedAt).getTime() - new Date(longest.startedAt).getTime())) {
                longest = { ...f, duration: durMin };
            }

            // Group by day (Colombia local: UTC-5)
            const localDate = new Date(new Date(f.startedAt).getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
            if (!byDayMap[localDate]) byDayMap[localDate] = { date: localDate, minutes: 0, count: 0 };
            byDayMap[localDate].minutes += durMin;
            byDayMap[localDate].count += 1;
        }

        const totalMinutes = Math.round(totalMs / 60000);
        const avgDurationMin = totalFailures > 0 ? Math.round(totalMinutes / totalFailures) : 0;
        const byDay = Object.values(byDayMap).sort((a, b) => a.date.localeCompare(b.date));

        // Active failure (not yet resolved)
        const activeFailure = await prisma.productionBatch.findFirst({
            where: {
                flavor: 'FALLA',
                startedAt: { not: null },
                completedAt: null,
                status: { notIn: ['COMPLETED', 'FAILED'] }
            },
            select: { id: true, startedAt: true, notes: true, batchNumber: true },
            orderBy: { startedAt: 'desc' }
        });

        res.json({
            totalFailures,
            totalMinutesLost: totalMinutes,
            totalHoursLost: Math.round(totalMinutes / 6) / 10,
            avgDurationMin,
            longest,
            byDay,
            activeFailure
        });
    } catch (error) {
        console.error('Error in failureStats:', error);
        res.status(500).json({ error: 'Error obteniendo estadísticas de fallas' });
    }
};
