const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const productionSchedulerController = require('../controllers/productionSchedulerController');

// Mock Req/Res
const req = {
    params: { flavor: 'MANGO BICHE CON SAL' }
};

const res = {
    json: (data) => console.log('Response:', JSON.stringify(data, null, 2)),
    status: (code) => ({ json: (data) => console.log(`Error ${code}:`, data) })
};

async function testMix() {
    try {
        await productionSchedulerController.calculateBatchMix(req, res);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

testMix();
