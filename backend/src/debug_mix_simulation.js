const axios = require('axios');

async function main() {
    try {
        // Assume running locally or port 3001/3002 based on previous knowledge
        // But better to use internal logic or just trigger via node if I can mock req/res.
        // Actually I can just look at the logs if I trigger it. 
        // But simpler to just run the logic code in isolation? 
        // No, I want to test the controller.

        // I will use a simple script that Connects to DB and runs the Logic directly, copying the controller code.
        // This avoids Auth middleware issues for a simple curl.

        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();

        const flavor = "MARACUYA";

        const products = await prisma.product.findMany({
            where: {
                group: { name: 'LIQUIPOPS' },
                flavor: { equals: flavor, mode: 'insensitive' },
                active: true
            }
        });

        console.log(`Found ${products.length} products for ${flavor}`);

        const TARGET_DAYS = 8;

        const _parseSize = (name) => {
            name = name.toUpperCase();
            if (name.includes('3400') || name.includes('3.4')) return { kgFactor: 3.4 };
            if (name.includes('1150') || name.includes('1.15')) return { kgFactor: 1.15 };
            if (name.includes('350')) return { kgFactor: 0.35 };
            return { kgFactor: 0 };
        };

        products.forEach(p => {
            const sizeInfo = _parseSize(p.name);
            const velocity = p.dailyVelocity || 0;
            const targetStock = velocity * TARGET_DAYS;
            const deficit = Math.max(0, targetStock - p.currentStock);
            const deficitKg = deficit * sizeInfo.kgFactor;

            console.log(`SKU: ${p.sku}, Velocity: ${velocity}, Target: ${targetStock}, Stock: ${p.currentStock}, Deficit: ${deficit}, DeficitKg: ${deficitKg}`);
        });

    } catch (e) {
        console.error(e);
    }
}

main();
