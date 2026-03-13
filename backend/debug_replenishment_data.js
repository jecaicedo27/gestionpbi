const { PrismaClient } = require('@prisma/client');
const dataMiningService = require('./src/services/dataMiningService');

async function debug() {
    try {
        console.log("Fetching projection...");
        const data = await dataMiningService.getReplenishmentProjection();

        console.log(`Total Products: ${data.length}`);

        // Count by type
        const typeCounts = {};
        data.forEach(p => {
            typeCounts[p.type] = (typeCounts[p.type] || 0) + 1;
        });
        console.log("Counts by Type:", typeCounts);

        // Inspect MP items
        const mpItems = data.filter(p => p.type === 'MATERIA_PRIMA');
        console.log(`MP Items: ${mpItems.length}`);

        if (mpItems.length > 0) {
            console.log("Sample MP Item:", mpItems[0]);

            // Log groups of MP items
            const groups = [...new Set(mpItems.map(p => p.group))];
            console.log("MP Groups:", groups);
        } else {
            console.log("WARNING: NO MP ITEMS FOUND IN PROJECTION!");
        }

    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}

debug();
