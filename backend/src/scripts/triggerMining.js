const dataMiningService = require('../services/dataMiningService');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        console.log('Starting manual data mining...');
        const result = await dataMiningService.calculateVelocities();
        console.log('Result:', result);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

run();
