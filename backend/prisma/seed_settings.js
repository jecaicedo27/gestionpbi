const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const defaultSettings = {
        targetDays: 8,
        minStockDays: 15,
        alertYellow: 12,
        alertRed: 3,
        batchSize: 120,
        batchDuration: 140
    };

    const existing = await prisma.systemSettings.findUnique({
        where: { key: 'PRODUCTION_CONFIG' }
    });

    if (!existing) {
        await prisma.systemSettings.create({
            data: {
                key: 'PRODUCTION_CONFIG',
                value: defaultSettings,
                description: 'Comportamiento del Programador de Producción y Niveles de Stock'
            }
        });
        console.log('✅ Created Default Settings');
    } else {
        console.log('ℹ️ Settings already exist');
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
