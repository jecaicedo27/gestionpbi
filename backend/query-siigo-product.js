const siigoService = require('./src/services/siigoService');

async function queryProductByCode(code) {
    try {
        console.log(`🔍 Consultando producto con código: ${code} en SIIGO...\n`);

        // Autenticar
        await siigoService.authenticate();
        console.log('✅ Autenticado con SIIGO\n');

        // Buscar el producto por código
        // SIIGO no tiene un endpoint directo by code, necesitamos buscar en todas las páginas
        let found = null;
        let page = 1;

        while (!found && page <= 50) { // Límite de seguridad
            const { results } = await siigoService.getProducts(page, 100);

            if (!results || results.length === 0) break;

            found = results.find(p => p.code === code);

            if (!found) {
                page++;
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }

        if (found) {
            console.log('✅ PRODUCTO ENCONTRADO:\n');
            console.log(JSON.stringify(found, null, 2));
            console.log('\n\n=== CAMPOS PRINCIPALES ===');
            console.log(`ID: ${found.id}`);
            console.log(`Código: ${found.code}`);
            console.log(`Nombre: ${found.name}`);
            console.log(`Stock Disponible: ${found.available_quantity || 0}`);
            console.log(`Activo: ${found.active}`);
            console.log(`Impuestos: ${JSON.stringify(found.taxes)}`);
            console.log(`Precios: ${JSON.stringify(found.prices)}`);

            if (found.account_group) {
                console.log(`\nGrupo Contable:`);
                console.log(`  - ID: ${found.account_group.id}`);
                console.log(`  - Nombre: ${found.account_group.name}`);
            }

            if (found.additional_fields) {
                console.log(`\nCampos Adicionales:`);
                console.log(JSON.stringify(found.additional_fields, null, 2));
            }
        } else {
            console.log(`❌ No se encontró ningún producto con el código: ${code}`);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.response) {
            console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

// Ejecutar
queryProductByCode('LIQC01');
