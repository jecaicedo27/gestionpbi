const siigoService = require('../services/siigoService');

async function inspectProduct() {
    try {
        await siigoService.authenticate();
        const { results } = await siigoService.getProducts(1, 3);

        console.log('\n========== PRODUCTOS DE SIIGO ==========\n');
        results.forEach((product, index) => {
            console.log(`\n--- PRODUCTO ${index + 1} ---`);
            console.log(JSON.stringify(product, null, 2));
            console.log('\n');
        });

        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

inspectProduct();
