const siigoService = require('../services/siigoService');

async function testAccountGroup() {
    try {
        await siigoService.authenticate();
        const { results } = await siigoService.getProducts(1, 1);

        const product = results[0];

        console.log('\n========== PRODUCTO DE TEST ==========');
        console.log('Nombre:', product.name);
        console.log('Code:', product.code);
        console.log('\naccount_group objeto completo:');
        console.log(JSON.stringify(product.account_group, null, 2));
        console.log('\naccount_group.id extraído:');
        console.log(product.account_group?.id);
        console.log('\n=====================================\n');

        console.log('Intentando sincronizar...');
        const synced = await siigoService.syncProduct(product);
        console.log('\n✅ Producto sincronizado');
        console.log('Resultado:', JSON.stringify(synced, null, 2));

        process.exit(0);
    } catch (error) {
        console.error('\n❌ ERROR:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

testAccountGroup();
