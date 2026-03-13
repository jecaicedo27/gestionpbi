const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const prisma = new PrismaClient();

const createProductionOrder = async (req, res) => {
    try {
        const { productId, quantity, scheduledDate } = req.body;
        const supervisorId = req.user.id;

        // Auto-generate Batch Number: B-{Year}{Month}{Day}-{Count}
        const today = new Date();
        const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
        const count = await prisma.productionBatch.count({
            where: {
                createdAt: {
                    gte: new Date(today.setHours(0, 0, 0, 0)),
                    lt: new Date(today.setHours(23, 59, 59, 999))
                }
            }
        });
        const batchCode = `B-${dateStr}-${String(count + 1).padStart(3, '0')}`;

        const result = await prisma.$transaction(async (tx) => {
            // Create Batch Record
            const batch = await tx.productionBatch.create({
                data: {
                    batchCode,
                    productId,
                    initialQty: quantity,
                    currentQty: quantity,
                    expirationDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000) // Approx 6 months
                }
            });

            // Create Production Order
            const order = await tx.productionOrder.create({
                data: {
                    productId,
                    quantity,
                    status: 'SCHEDULED',
                    scheduledDate: new Date(scheduledDate),
                    supervisorId,
                    batchId: batch.id
                },
                include: { product: true, batch: true }
            });

            return order;
        });

        logger.info(`Production Scheduled: ${result.id} for Batch ${batchCode}`);
        res.json({ success: true, data: result });

    } catch (error) {
        logger.error('Create Production Error:', error);
        res.status(500).json({ error: 'Error programando producción' });
    }
};

const getSchedule = async (req, res) => {
    try {
        const { start, end } = req.query;

        const orders = await prisma.productionOrder.findMany({
            where: {
                scheduledDate: {
                    gte: start ? new Date(start) : undefined,
                    lte: end ? new Date(end) : undefined
                }
            },
            include: {
                product: { select: { name: true, sku: true } },
                batch: { select: { batchCode: true } }
            },
            orderBy: { scheduledDate: 'asc' }
        });

        res.json({ success: true, data: orders });
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo calendario' });
    }
};

const updateSchedule = async (req, res) => {
    try {
        const { id } = req.params;
        const { scheduledDate, status } = req.body;

        const order = await prisma.productionOrder.update({
            where: { id },
            data: {
                ...(scheduledDate && { scheduledDate: new Date(scheduledDate) }),
                ...(status && { status }),
                ...(status === 'COMPLETED' ? { completedAt: new Date() } : {})
            }
        });

        res.json({ success: true, data: order });
    } catch (error) {
        res.status(500).json({ error: 'Error actualizando producción' });
    }
};

module.exports = { createProductionOrder, getSchedule, updateSchedule };
