const { PrismaClient } = require('@prisma/client');
const dataMiningService = require('../services/dataMiningService');
const prisma = new PrismaClient();

exports.getReplenishment = async (req, res) => {
    try {
        const projection = await dataMiningService.getReplenishmentProjection();
        res.json(projection);
    } catch (error) {
        console.error('Replenishment Projection Error:', error);
        res.status(500).json({ error: 'Failed to generate replenishment projection' });
    }
};

exports.runMining = async (req, res) => {
    try {
        const result = await dataMiningService.calculateVelocities();
        res.json({ message: 'Data Mining Completed', result });
    } catch (error) {
        console.error('Data Mining Trigger Error:', error);
        res.status(500).json({ error: 'Failed to run data mining' });
    }
};
exports.getConsumption = async (req, res) => {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30); // Last 30 days

        const movements = await prisma.movement.groupBy({
            by: ['date'],
            where: {
                date: { gte: cutoffDate },
                type: { in: ['VTA', 'CONS'] }
            },
            _sum: {
                quantity: true
            },
            orderBy: {
                date: 'asc'
            }
        });

        const formattedData = movements.map(m => ({
            date: m.date.toISOString().split('T')[0],
            value: m._sum.quantity || 0
        }));

        res.json({ success: true, data: { data: formattedData } });
    } catch (error) {
        console.error('Consumption Error:', error);
        res.status(500).json({ error: 'Failed to fetch consumption data' });
    }
};
