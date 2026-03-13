const siigoService = require('../services/siigoService');

async function showProductJson() {
    try {
        await siigoService.authenticate();
        const { results } = await siigoService.getProducts(1, 1);

        if (results && results.length > 0) {
            console.log('EJEMPLO JSON PRODUCTO DE SIIGO:\n');
            console.log(JSON.stringify(results[0], null, 2));
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

showProductJson();
