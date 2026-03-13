const siigoService = require('../services/siigoService');

async function debugPagination() {
    console.log('Fetching Page 1 to inspect Pagination object...');
    try {
        const response = await siigoService.getProducts(1, 10);
        console.log('--- PAGINATION OBJECT ---');
        console.log(JSON.stringify(response.pagination, null, 2));
        console.log('--- END ---');
    } catch (error) {
        console.error('Error:', error.message);
    }
}

debugPagination();
