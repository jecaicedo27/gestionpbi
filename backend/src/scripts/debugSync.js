const siigoService = require('../services/siigoService');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debugSync() {
    try {
        console.log('🔍 Debugging syncProduct...\n');

        await siigoService.authenticate();
        const { results } = await siigoService.getProducts(1, 1);
        const product = results[0];

        console.log('📦 Producto de SIIGO:');
        console.log('  - Nombre:', product.name);
        console.log('  - Code:', product.code);
        console.log('  - account_group.id:', product.account_group?.id);
        console.log('  - account_group.name:', product.account_group?.name);

        console.log('\n🔄 Ejecutando syncProduct...');
        const synced = await siigoService.syncProduct(product);

        if (synced) {
            console.log('\n✅ Producto retornado por syncProduct:');
            console.log(JSON.stringify(synced, null, 2));

            console.log('\n🔍 Verificando en DB...');
            const dbProduct = await prisma.product.findUnique({
                where: { siigoId: product.id }
            });

            console.log('\n📊 Producto en DB:');
            console.log('  - accountGroup:', dbProduct.accountGroup);
            console.log('  - groupId:', dbProduct.groupId);
            console.log('  - barcode:', dbProduct.barcode);
        } else {
            console.log('\n❌ syncProduct retornó undefined');
        }

        process.exit(0);
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

debugSync();
