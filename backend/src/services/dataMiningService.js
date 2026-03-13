const XLSX = require('xlsx');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const cacheService = require('./cacheService');

const prisma = new PrismaClient();

class DataMiningService {
    constructor() {
        this.filePath = path.join(__dirname, '../../Movimiento.xlsx');
    }

    async calculateVelocities() {
        logger.info('⛏️ Starting Data Mining from Movement Table...');

        try {
            // Define Cutoff (Last 90 days)
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 90);

            logger.info(`📅 Target Analysis Window: Last 90 days (From ${cutoffDate.toISOString().split('T')[0]})`);

            // 1. Fetch Movements from DB
            const movements = await prisma.movement.findMany({
                where: {
                    date: { gte: cutoffDate },
                    type: { in: ['VTA', 'CONS'] } // CONS is from NE (Assembly), VTA is Sales
                },
                include: { product: true }
            });

            if (movements.length === 0) {
                logger.warn('⚠️ No movements found to calculate velocities.');
                return { updated: 0, daysAnalyzed: 0 };
            }

            const consumptionMap = {};
            let minDate = new Date();
            let maxDate = new Date(0);

            for (const moving of movements) {
                if (moving.date < minDate) minDate = moving.date;
                if (moving.date > maxDate) maxDate = moving.date;

                const sku = moving.product.sku;
                if (!consumptionMap[sku]) consumptionMap[sku] = 0;
                consumptionMap[sku] += moving.quantity;
            }

            // 2. Calculate Days Range
            const timeDiff = Math.abs(maxDate.getTime() - minDate.getTime());
            const daysRange = Math.ceil(timeDiff / (1000 * 3600 * 24)) || 1; // Avoid division by zero

            logger.info(`📅 Analysis Period: ${daysRange} days (${minDate.toISOString().split('T')[0]} to ${maxDate.toISOString().split('T')[0]})`);

            // 3. Update Velocities in DB
            let updatedCount = 0;
            const skuList = Object.keys(consumptionMap);

            const config = await require('../controllers/configController').getInternalConfig() || { minStockDays: 15 };
            const MIN_STOCK_DAYS = config.minStockDays || 15;

            for (const sku of skuList) {
                const totalConsumed = consumptionMap[sku];
                const velocity = totalConsumed / daysRange;

                // Find product by SKU/Code
                const product = await prisma.product.findFirst({
                    where: { OR: [{ sku: sku }, { barcode: sku }] }
                });

                if (product) {
                    await prisma.product.update({
                        where: { id: product.id },
                        data: {
                            dailyVelocity: velocity,
                            // daysOfStock update could happen here or in a separate pass
                            daysOfStock: product.currentStock > 0 && velocity > 0 ? (product.currentStock / velocity) : 0,
                            // Update Minimum Stock based on Velocity (Dynamic Config)
                            minimumStock: Math.ceil(velocity * MIN_STOCK_DAYS)
                        }
                    });
                    updatedCount++;
                }
            }

            logger.info(`✅ Updated velocity for ${updatedCount} products.`);

            // Invalidate cache so frontend gets fresh data immediately
            await cacheService.invalidatePattern('replenishment_projection_v2');

            return { updated: updatedCount, daysAnalyzed: daysRange };

        } catch (error) {
            logger.error('Data Mining Failed:', error);
            throw error;
        }
    }

    async getReplenishmentProjection() {
        const cacheKey = 'replenishment_projection_v2';
        return cacheService.getOrFetch(cacheKey, async () => {

            // Ensure velocities are up to date (Optional: could be a scheduled job instead)
            await this.calculateVelocities();

            const products = await prisma.product.findMany({
                where: { active: true },
                orderBy: { name: 'asc' },
                include: { group: true }
            });

            return products.map(p => {
                const v = p.dailyVelocity || 0;

                // Suggestions
                const needed15 = v * 15;
                const needed30 = v * 30;
                const needed45 = v * 45;

                const toBuy15 = Math.max(0, needed15 - p.currentStock);
                const toBuy30 = Math.max(0, needed30 - p.currentStock);
                const toBuy45 = Math.max(0, needed45 - p.currentStock);

                return {
                    id: p.id,
                    code: p.sku,
                    name: p.name,
                    group: p.group?.name || 'Otro',
                    type: p.type,
                    flavor: p.flavor, // Added
                    size: p.size,     // Added
                    minimumStock: p.minimumStock, // Added
                    packSize: p.packSize,         // Added
                    currentStock: p.currentStock,
                    velocity: v, // Daily consumption
                    daysOfStock: p.daysOfStock,
                    projections: {
                        days15: { needed: needed15, toBuy: toBuy15 },
                        days30: { needed: needed30, toBuy: toBuy30 },
                        days45: { needed: needed45, toBuy: toBuy45 }
                    }
                };
            }).filter(p => p.velocity > 0 || p.currentStock > 0); // Show items with movement OR stock
        }, 300); // Cache for 5 mins
    }
}

module.exports = new DataMiningService();
