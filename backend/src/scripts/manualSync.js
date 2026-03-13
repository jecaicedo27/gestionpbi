const siigoService = require('../services/siigoService');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    console.log('Starting manual sync...');
    try {
        await siigoService.syncAllProducts();
        console.log('Sync completed successfully.');
    } catch (error) {
        console.error('Sync failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

run();
