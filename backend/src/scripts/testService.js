const dataMiningService = require('../services/dataMiningService');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        console.log('Fetching projection...');
        const result = await dataMiningService.getReplenishmentProjection();
        console.log(`Total Items: ${result.length}`);

        const geniality = result.filter(i => i.group === 'GENIALITY');
        console.log(`GENIALITY Items: ${geniality.length}`);

        const liquipops = result.filter(i => i.group === 'LIQUIPOPS');
        console.log(`LIQUIPOPS Items: ${liquipops.length}`);

        if (geniality.length > 0) {
            console.log('Sample GENIALITY Item:', JSON.stringify(geniality[0], null, 2));
        }

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
