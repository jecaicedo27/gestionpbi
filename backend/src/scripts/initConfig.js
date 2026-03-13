const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function initConfig() {
    try {
        await prisma.systemSettings.upsert({
            where: { key: 'PRODUCTION_CONFIG' },
            update: {
                value: {
                    targetDays: 8,
                    minStockDays: 15,
                    alertYellow: 12,
                    alertRed: 3,
                    syrupRatio: 0.70
                }
            },
            create: {
                key: 'PRODUCTION_CONFIG',
                value: {
                    targetDays: 8,
                    minStockDays: 15,
                    alertYellow: 12,
                    alertRed: 3,
                    syrupRatio: 0.70
                },
                description: 'Production Config with Syrup Ratio'
            }
        });
        console.log('✓ Config initialized with syrupRatio = 0.70');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

initConfig();
