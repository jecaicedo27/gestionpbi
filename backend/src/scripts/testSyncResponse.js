
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        // We need a valid token. For this test, we might need to bypass auth or login.
        // Or we can just inspect the controller code which I've already done.
        // But to be sure, let's call the function directly by mocking req/res if possible? 
        // No, that's complicated with dependencies.

        // Simpler: Just rely on my code review and the restart logs.
        // But to be thorough, I will use a simple script that imports the controller and mocks req/res.

        const inventoryController = require('../controllers/inventoryController');

        // Mock Request and Response
        const req = { query: { page: 1 } };
        const res = {
            json: (data) => {
                if (data.data && data.data.length > 0) {
                    const first = data.data.find(p => p.dailyVelocity !== undefined);
                    if (first) {
                        console.log('✅ Success! Sync Response contains dailyVelocity.');
                        console.log('Sample:', {
                            name: first.name,
                            velocity: first.dailyVelocity,
                            packSize: first.packSize
                        });
                    } else {
                        console.error('❌ Failed! dailyVelocity missing in sync response.');
                        console.log('First Item Keys:', Object.keys(data.data[0]));
                    }
                } else {
                    console.log('No products returned.');
                }
            },
            status: (code) => ({ json: (d) => console.error(`Error ${code}:`, d) })
        };

        await inventoryController.syncFromSiigo(req, res);

    } catch (error) {
        console.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
