const dataMiningService = require('../services/dataMiningService');
const logger = require('../utils/logger');

async function main() {
    console.log('🚀 Triggering manual velocity calculation...');
    try {
        const result = await dataMiningService.calculateVelocities();
        console.log('✅ Velocity calculation complete:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('❌ Failed to calculate velocities:', error);
        process.exit(1);
    }
}

main();
