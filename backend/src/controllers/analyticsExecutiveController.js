const XLSX = require('xlsx');
const path = require('path');

// Helper to parse size/weight from product name
const parseSize = (name) => {
    // Looks for patterns like "X 1000 ML", "X 500 GR"
    const regex = /X\s*(\d+)\s*(ML|GR|G|L|KG)/i;
    const match = name.match(regex);
    if (!match) return { value: 0, unit: 'N/A', kgFactor: 0 };

    let value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    let kgFactor = 0;

    // Convert to KG/L equivalent
    if (unit === 'ML' || unit === 'GR' || unit === 'G') {
        kgFactor = value / 1000;
    } else if (unit === 'L' || unit === 'KG') {
        kgFactor = value;
    }

    return { value, unit, kgFactor };
};

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getExecutiveStats = async (req, res) => {
    try {
        // Fetch valid Finished Products codes with their Group Name and Flavor
        const finishedProducts = await prisma.product.findMany({
            where: { classification: 'PRODUCTO_TERMINADO' },
            select: {
                id: true,
                sku: true,
                flavor: true,
                group: { select: { name: true } }
            }
        });

        // Map SKU -> Group Name & Flavor
        const skuMap = new Map();
        finishedProducts.forEach(p => {
            skuMap.set(p.sku, {
                group: p.group?.name || 'UNKNOWN',
                flavor: p.flavor || 'VARIOS'
            });
        });

        // 2. Fetch Movements from DB
        const movements = await prisma.movement.findMany({
            where: {
                productId: { in: finishedProducts.map(p => p.id) }
            },
            include: { product: true }
        });

        // Stats containers
        const stats = {
            global: {},
            geniality: {},
            liquipops: {}
        };
        const productStats = {};
        const flavorStats = { // Aggregate by flavor
            geniality: {},
            liquipops: {}
        };
        const allMonths = new Set();

        const initMonth = (statObj, key) => {
            if (!statObj[key]) statObj[key] = { producedKg: 0, soldKg: 0 };
        };

        const addToFlavor = (segment, flavor, soldKg, producedKg, sizeInfo) => {
            const key = segment.toLowerCase();
            if (!flavorStats[key]) return;

            if (!flavorStats[key][flavor]) {
                flavorStats[key][flavor] = {
                    totalSalesKg: 0,
                    sizes: {}
                };
            }

            flavorStats[key][flavor].totalSalesKg += soldKg;
            const sizeLabel = sizeInfo.size > 0 ? `${sizeInfo.size} ${sizeInfo.unit}` : 'N/A';
            if (!flavorStats[key][flavor].sizes[sizeLabel]) flavorStats[key][flavor].sizes[sizeLabel] = 0;
            flavorStats[key][flavor].sizes[sizeLabel] += producedKg;
        };

        movements.forEach(moving => {
            const product = moving.product;
            const { group: groupName, flavor } = skuMap.get(product.sku) || { group: 'UNKNOWN', flavor: 'VARIOS' };

            const { value: sizeVal, unit, kgFactor } = parseSize(product.name);
            const sizeInfo = { size: sizeVal, unit };

            const monthKey = moving.date.toISOString().substring(0, 7); // YYYY-MM
            allMonths.add(monthKey);

            const quantity = moving.quantity;
            const weightKg = quantity * kgFactor;

            initMonth(stats.global, monthKey);

            if (moving.type === 'VTA') {
                stats.global[monthKey].soldKg += weightKg;
                if (groupName === 'GENIALITY') {
                    initMonth(stats.geniality, monthKey);
                    stats.geniality[monthKey].soldKg += weightKg;
                    addToFlavor('geniality', flavor, weightKg, 0, sizeInfo);
                } else if (groupName === 'LIQUIPOPS') {
                    initMonth(stats.liquipops, monthKey);
                    stats.liquipops[monthKey].soldKg += weightKg;
                    addToFlavor('liquipops', flavor, weightKg, 0, sizeInfo);
                }
            } else if (moving.type === 'PROD') {
                stats.global[monthKey].producedKg += weightKg;
                if (groupName === 'GENIALITY') {
                    initMonth(stats.geniality, monthKey);
                    stats.geniality[monthKey].producedKg += weightKg;
                    addToFlavor('geniality', flavor, 0, weightKg, sizeInfo);
                } else if (groupName === 'LIQUIPOPS') {
                    initMonth(stats.liquipops, monthKey);
                    stats.liquipops[monthKey].producedKg += weightKg;
                    addToFlavor('liquipops', flavor, 0, weightKg, sizeInfo);
                }
            }

            // Product Detail Stats for table
            if (!productStats[product.sku]) {
                productStats[product.sku] = {
                    code: product.sku,
                    name: product.name,
                    size: sizeVal > 0 ? `${sizeVal} ${unit}` : 'N/A',
                    kgFactor,
                    segment: groupName,
                    months: {}
                };
            }

            if (!productStats[product.sku].months[monthKey]) {
                productStats[product.sku].months[monthKey] = { produced: 0, sold: 0 };
            }

            if (moving.type === 'VTA') productStats[product.sku].months[monthKey].sold += quantity;
            if (moving.type === 'PROD') productStats[product.sku].months[monthKey].produced += quantity;
        });

        // Convert to Arrays for Frontend
        const sortedMonths = Array.from(allMonths).sort();

        const buildChartData = (statObj) => sortedMonths.map(month => ({
            month,
            producedKg: Math.round(statObj[month]?.producedKg || 0),
            soldKg: Math.round(statObj[month]?.soldKg || 0)
        }));

        const buildFlavorRanking = (flavorObj) => {
            return Object.entries(flavorObj)
                .map(([flavor, data]) => {
                    // Calculate size percentages
                    const totalProduction = Object.values(data.sizes).reduce((a, b) => a + b, 0);
                    const sizesArray = Object.entries(data.sizes).map(([size, kg]) => ({
                        size,
                        kg,
                        percentage: totalProduction > 0 ? (kg / totalProduction) * 100 : 0
                    })).sort((a, b) => b.kg - a.kg);

                    return {
                        flavor,
                        totalSalesKg: Math.round(data.totalSalesKg), // Sales for Y-axis ranking
                        sizeDistribution: sizesArray // Production Breakdown
                    };
                })
                .sort((a, b) => b.totalSalesKg - a.totalSalesKg); // Sort by Scales
        };

        const tableData = Object.values(productStats).map(p => {
            const row = {
                code: p.code,
                name: p.name,
                size: p.size,
                kgFactor: p.kgFactor,
                segment: p.segment
            };
            sortedMonths.forEach(m => {
                const mData = p.months[m] || { produced: 0, sold: 0 };
                row[`produced_${m}`] = mData.produced;
                row[`sold_${m}`] = mData.sold;
            });
            return row;
        });

        res.json({
            months: sortedMonths,
            chartData: {
                global: buildChartData(stats.global),
                geniality: buildChartData(stats.geniality),
                liquipops: buildChartData(stats.liquipops)
            },
            flavorStats: {
                geniality: buildFlavorRanking(flavorStats.geniality),
                liquipops: buildFlavorRanking(flavorStats.liquipops)
            },
            tableData
        });

    } catch (error) {
        console.error('Error generating executive stats:', error);
        res.status(500).json({ error: 'Error processing data' });
    }
};
