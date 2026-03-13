const siigoService = require('../services/siigoService');
const logger = require('../utils/logger');

async function run() {
    console.log('🚀 Triggering manual syncAllProducts()...');
    try {
        const result = await siigoService.syncAllProducts();
        console.log('✅ Result:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('❌ Manual trigger failed:', error);
    }
}

run();
