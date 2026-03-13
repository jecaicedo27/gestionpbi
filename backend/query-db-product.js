const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function queryProductInDB(sku) {
    try {
        console.log(`🔍 Consultando producto con SKU: ${sku} en la Base de Datos...\n`);

        const product = await prisma.product.findUnique({
            where: { sku: sku },
            include: {
                group: true
            }
        });

        if (product) {
            console.log('✅ PRODUCTO ENCONTRADO EN BD:\n');
            console.log(JSON.stringify(product, null, 2));
            console.log('\n\n=== COMPARACIÓN SIIGO vs BD ===');
            console.log(`SKU: ${product.sku}`);
            console.log(`Código de Barras en BD: ${product.barcode}`);
            console.log(`Código de Barras en SIIGO: 7708949649993`);
            console.log(`¿Coinciden? ${product.barcode === '7708949649993' ? '✅ SÍ' : '❌ NO'}`);
            console.log(`\nNombre: ${product.name}`);
            console.log(`Precio: $${product.price}`);
            console.log(`Stock: ${product.currentStock}`);
            console.log(`Grupo: ${product.group?.name || 'N/A'}`);
        } else {
            console.log(`❌ No se encontró el producto con SKU: ${sku} en la base de datos`);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}

// Ejecutar
queryProductInDB('LIQC01');
