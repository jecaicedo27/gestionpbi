const siigoService = require('./src/services/siigoService');

async function test() {
    try {
        console.log('Testing new SiigoService auth...');
        const result = await siigoService.getProducts(1, 5);
        console.log('Successfully fetched products:', result.results.length);
        if (result.results.length > 0) {
            console.log('Sample product:', result.results[0].name);
        }
    } catch (e) {
        console.error('Test failed:', e.message);
        if (e.response) {
            console.error('Status:', e.response.status);
            console.error('Data:', e.response.data);
        }
    }
}

test();
