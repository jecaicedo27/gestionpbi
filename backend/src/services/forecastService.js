/**
 * forecastService.js — Adaptive Forecast Engine
 * 
 * Calculates raw material needs based on:
 * 1. Seasonality index (monthly historical patterns)
 * 2. Year-over-year growth factor
 * 3. Recent trend (last 4 weeks weighted higher)
 * 4. Configurable buffer percentage
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');

// Process prefixes that should be excluded from purchasing forecast
const PROCESS_PREFIXES = ['PROCE'];

function isProcessProduct(sku) {
    return PROCESS_PREFIXES.some(p => sku.startsWith(p));
}

/**
 * Get forecast configuration values with defaults
 */
async function getConfig() {
    const configs = await prisma.forecastConfig.findMany();
    const map = {};
    configs.forEach(c => { map[c.key] = c.value; });
    return {
        inventoryWeeks: parseInt(map['inventory_weeks'] || '3'),
        bufferPct: parseInt(map['buffer_pct'] || '15'),
        growthBufferPct: parseInt(map['growth_buffer_pct'] || '20'),
    };
}

/**
 * Calculate monthly seasonality indices from historical consumption.
 * Normalizes by days with data per month to avoid partial-month distortion.
 * Returns an object { 1: 1.2, 2: 0.8, ... 12: 1.5 } where 1.0 = average
 */
async function calculateSeasonalityIndices() {
    // Get monthly totals with day count to normalize partial months
    const monthlyTotals = await prisma.$queryRaw`
        SELECT EXTRACT(MONTH FROM m.date)::int as month,
               SUM(m.quantity)::float as total,
               COUNT(DISTINCT m.date::date)::int as days_with_data
        FROM movements m
        WHERE m.type = 'CONS'
        GROUP BY EXTRACT(MONTH FROM m.date)
        ORDER BY month
    `;

    if (!monthlyTotals.length) return {};

    // Normalize: compute daily rate per month, then scale to 30-day equivalent
    const normalized = monthlyTotals.map(m => ({
        month: m.month,
        dailyRate: m.days_with_data > 0 ? m.total / m.days_with_data : 0,
        days: m.days_with_data
    }));

    const avgDailyRate = normalized.reduce((s, m) => s + m.dailyRate, 0) / normalized.length;
    const indices = {};
    normalized.forEach(m => {
        indices[m.month] = avgDailyRate > 0 ? m.dailyRate / avgDailyRate : 1.0;
    });
    return indices;
}

/**
 * Calculate year-over-year growth factor.
 * Compares ONLY months that have data in both years to avoid distortion.
 * Caps between 0.7 and 1.5 to prevent extreme values.
 */
async function calculateGrowthFactor() {
    // Compare month-by-month: only months with data in both current and previous year
    const monthlyByYear = await prisma.$queryRaw`
        SELECT EXTRACT(YEAR FROM m.date)::int as yr,
               EXTRACT(MONTH FROM m.date)::int as mo,
               SUM(m.quantity)::float as total
        FROM movements m
        WHERE m.type = 'CONS'
        GROUP BY yr, mo
        ORDER BY yr, mo
    `;

    // Group by year → { 2025: { 1: total, 2: total, ... }, 2026: { ... } }
    const byYear = {};
    for (const row of monthlyByYear) {
        if (!byYear[row.yr]) byYear[row.yr] = {};
        byYear[row.yr][row.mo] = row.total;
    }

    const years = Object.keys(byYear).sort();
    if (years.length < 2) return 1.0; // No YoY comparison possible

    const currentYear = parseInt(years[years.length - 1]);
    const previousYear = parseInt(years[years.length - 2]);

    // Find months that exist in BOTH years
    const currentData = byYear[currentYear] || {};
    const previousData = byYear[previousYear] || {};
    const overlappingMonths = Object.keys(currentData).filter(m => previousData[m]);

    if (overlappingMonths.length === 0) return 1.0;

    let currentTotal = 0, previousTotal = 0;
    for (const m of overlappingMonths) {
        currentTotal += currentData[m];
        previousTotal += previousData[m];
    }

    if (previousTotal === 0) return 1.0;
    const rawGrowth = currentTotal / previousTotal;

    // Cap between 0.7 (max 30% decline) and 1.5 (max 50% growth)
    const capped = Math.min(1.5, Math.max(0.7, rawGrowth));
    logger.info(`[Forecast] YoY Growth: ${rawGrowth.toFixed(2)} (months compared: ${overlappingMonths.join(',')} of ${currentYear} vs ${previousYear}) → capped: ${capped.toFixed(2)}`);
    return capped;
}

/**
 * Calculate per-product forecast
 */
async function calculateForecast() {
    const config = await getConfig();
    const seasonality = await calculateSeasonalityIndices();
    const growthFactor = await calculateGrowthFactor();
    const currentMonth = new Date().getMonth() + 1;
    const seasonalIndex = seasonality[currentMonth] || 1.0;

    // Get date range of consumption data
    const dateRange = await prisma.movement.aggregate({
        where: { type: 'CONS' },
        _min: { date: true },
        _max: { date: true }
    });

    const oldestDate = dateRange._min.date;
    const newestDate = dateRange._max.date;
    if (!oldestDate || !newestDate) return { products: [], config, growthFactor, seasonalIndex };

    const totalWeeks = Math.max(1, (newestDate - oldestDate) / (7 * 24 * 60 * 60 * 1000));

    // Get last 4 weeks of consumption per product
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

    // All-time consumption grouped by product
    const allTimeCons = await prisma.movement.groupBy({
        by: ['productId'],
        where: { type: 'CONS' },
        _sum: { quantity: true },
        _count: { id: true }
    });

    // Recent consumption (last 4 weeks) grouped by product
    const recentCons = await prisma.movement.groupBy({
        by: ['productId'],
        where: { type: 'CONS', date: { gte: fourWeeksAgo } },
        _sum: { quantity: true }
    });
    const recentMap = {};
    recentCons.forEach(r => { recentMap[r.productId] = r._sum.quantity || 0; });

    // Special overrides per product (weeks of inventory)
    const PRODUCT_WEEK_OVERRIDES = {
        'ALGINATO': 12  // Alginato needs 12 weeks minimum
    };

    // Pre-fetch active PO items (not completed/cancelled) grouped by SKU
    const activePOItems = await prisma.purchaseOrderItem.findMany({
        where: {
            purchaseOrder: {
                status: { notIn: ['COMPLETED', 'CANCELLED'] }
            }
        },
        select: {
            siigoProductCode: true,
            quantityOrdered: true,
            quantityReceived: true,
            purchaseOrder: {
                select: { id: true, orderNumber: true, status: true, supplierName: true }
            }
        }
    });
    const poByProduct = {};
    activePOItems.forEach(item => {
        if (!poByProduct[item.siigoProductCode]) poByProduct[item.siigoProductCode] = [];
        poByProduct[item.siigoProductCode].push({
            orderId: item.purchaseOrder.id,
            orderNumber: item.purchaseOrder.orderNumber,
            status: item.purchaseOrder.status,
            supplierName: item.purchaseOrder.supplierName,
            quantityOrdered: item.quantityOrdered,
            quantityReceived: item.quantityReceived,
            pending: item.quantityOrdered - item.quantityReceived
        });
    });

    // Build forecast per product
    const products = [];
    for (const c of allTimeCons) {
        const product = await prisma.product.findUnique({
            where: { id: c.productId },
            select: { id: true, sku: true, name: true, unit: true, currentStock: true, active: true, packSize: true, group: { select: { name: true } } }
        });
        if (!product || !product.active || isProcessProduct(product.sku)) continue;

        const groupName = product.group?.name || 'Sin grupo';

        const totalConsumed = c._sum.quantity || 0;
        const historicalWeeklyAvg = totalConsumed / totalWeeks;
        const recentWeeklyAvg = (recentMap[c.productId] || 0) / 4;

        // Adaptive forecast: 40% recent + 60% historical adjusted
        const adjustedHistorical = historicalWeeklyAvg * seasonalIndex * growthFactor;
        const forecastWeekly = (recentWeeklyAvg * 0.4) + (adjustedHistorical * 0.6);

        // Check for per-product inventory week override
        const overrideKey = Object.keys(PRODUCT_WEEK_OVERRIDES).find(k => product.name.toUpperCase().includes(k));
        const productInventoryWeeks = overrideKey ? PRODUCT_WEEK_OVERRIDES[overrideKey] : config.inventoryWeeks;

        // Determine if trend is growing (for buffer adjustment)
        const isGrowing = recentWeeklyAvg > historicalWeeklyAvg * 1.1;
        const bufferMultiplier = isGrowing
            ? (1 + config.growthBufferPct / 100)
            : (1 + config.bufferPct / 100);

        const need = forecastWeekly * productInventoryWeeks * bufferMultiplier;

        // Get stock: prefer MaterialLot if available, fallback to Product.currentStock (Siigo)
        const lotStock = await prisma.materialLot.aggregate({
            where: {
                siigoProductCode: product.sku,
                status: { in: ['AVAILABLE', 'LOW_STOCK'] }
            },
            _sum: { currentQuantity: true }
        });
        const lotQty = lotStock._sum.currentQuantity || 0;
        const siigoStock = product.currentStock || 0;
        const currentStock = lotQty > 0 ? lotQty : siigoStock;
        const stockSource = lotQty > 0 ? 'lots' : (siigoStock > 0 ? 'siigo' : 'none');
        const deficit = Math.max(0, need - currentStock);

        // Get packaging info
        const packaging = await prisma.productPackaging.findUnique({
            where: { siigoProductCode: product.sku }
        });

        if (forecastWeekly > 0) {
            const activePOs = poByProduct[product.sku] || [];
            const totalOnOrder = activePOs.reduce((sum, po) => sum + po.pending, 0);

            products.push({
                productId: product.id,
                sku: product.sku,
                name: product.name,
                unit: product.unit,
                groupName,
                inventoryWeeks: productInventoryWeeks,
                historicalWeeklyAvg: Math.round(historicalWeeklyAvg),
                recentWeeklyAvg: Math.round(recentWeeklyAvg),
                forecastWeekly: Math.round(forecastWeekly),
                seasonalIndex: parseFloat(seasonalIndex.toFixed(2)),
                growthFactor: parseFloat(growthFactor.toFixed(2)),
                isGrowing,
                need: Math.round(need),
                currentStock,
                stockSource,
                deficit: Math.round(deficit),
                weeksOfStock: forecastWeekly > 0 ? parseFloat((currentStock / forecastWeekly).toFixed(1)) : 999,
                activePOs,
                totalOnOrder,
                packaging: packaging ? {
                    desc: packaging.packagingDesc,
                    gramsPerUnit: packaging.gramsPerUnit,
                    unitsNeeded: packaging.gramsPerUnit > 0 ? Math.ceil(deficit / packaging.gramsPerUnit) : null
                } : null,
                packSize: product.packSize || 0,
                packsNeeded: (product.packSize && product.packSize > 1 && deficit > 0)
                    ? Math.ceil(deficit / product.packSize)
                    : null,
                deficitRounded: (product.packSize && product.packSize > 1 && deficit > 0)
                    ? Math.ceil(deficit / product.packSize) * product.packSize
                    : Math.round(deficit)
            });
        }
    }

    // Sort by deficit (most needed first)
    products.sort((a, b) => b.deficit - a.deficit);

    return {
        products,
        config,
        meta: {
            totalProducts: products.length,
            growthFactor: parseFloat(growthFactor.toFixed(2)),
            seasonalIndex: parseFloat(seasonalIndex.toFixed(2)),
            currentMonth,
            dataWeeks: Math.round(totalWeeks),
            inventoryWeeks: config.inventoryWeeks,
            bufferPct: config.bufferPct,
            productsInDeficit: products.filter(p => p.deficit > 0).length,
            totalDeficitKg: Math.round(products.reduce((s, p) => s + p.deficit, 0) / 1000)
        }
    };
}

module.exports = {
    calculateForecast,
    calculateSeasonalityIndices,
    calculateGrowthFactor,
    getConfig,
    isProcessProduct
};
