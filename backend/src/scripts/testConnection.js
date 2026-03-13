const siigoService = require('../services/siigoService');

async function test() {
    console.log('Testing Siigo Connection...');
    try {
        const products = await siigoService.getProducts(1, 1);
        console.log('Connection Successful!');
        console.log('Results count:', products.results.length);
        if (products.results.length > 0) {
            console.log('First product sample:', JSON.stringify(products.results[0], null, 2));
        } else {
            console.log('No products found, but connection works.');
        }
    } catch (error) {
        console.error('Connection Failed:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

test();
