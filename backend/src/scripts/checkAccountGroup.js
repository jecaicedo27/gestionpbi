const siigoService = require('../services/siigoService');

async function checkAccountGroup() {
    try {
        await siigoService.authenticate();

        // Check a few LIQUIPOPS etiquetas products
        const skus = ['MPET31', 'MPET19', 'MPET43'];

        for (const sku of skus) {
            const { results } = await siigoService.getProducts(1, 100);
            const product = results.find(p => p.code === sku);

            if (product) {
                console.log('\n===================');
                console.log('SKU:', sku);
                console.log('Name:', product.name);
                console.log('Account Group:', product.account_group);
                console.log('Type:', product.type);
                console.log('Full data:', JSON.stringify(product, null, 2));
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

checkAccountGroup();
