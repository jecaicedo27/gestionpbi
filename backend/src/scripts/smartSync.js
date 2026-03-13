const siigoService = require('../services/siigoService');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class SmartSync {
    constructor() {
        this.maxRetries = 3;
        this.baseDelay = 2000; // 2 seconds
        this.batchSize = 50; // productos por lote
        this.delayBetweenBatches = 5000; // 5 segundos entre lotes
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async fetchWithRetry(page, pageSize, attempt = 1) {
        try {
            const result = await siigoService.getProducts(page, pageSize);
            return result;
        } catch (error) {
            if (error.response?.status === 429 && attempt < this.maxRetries) {
                // Exponential backoff: 2s, 4s, 8s
                const delay = this.baseDelay * Math.pow(2, attempt - 1);
                console.log(`⏳ Rate limit alcanzado. Esperando ${delay / 1000}s antes de reintentar (intento ${attempt}/${this.maxRetries})...`);
                await this.sleep(delay);
                return this.fetchWithRetry(page, pageSize, attempt + 1);
            }
            throw error;
        }
    }

    async syncBatch(products) {
        let synced = 0;
        let errors = 0;

        for (const product of products) {
            try {
                await siigoService.syncProduct(product);
                synced++;
            } catch (err) {
                errors++;
                console.error(`❌ Error: ${product.code} - ${err.message}`);
            }
        }

        return { synced, errors };
    }

    async run() {
        try {
            console.log('🚀 Iniciando sincronización inteligente desde SIIGO...\n');
            await siigoService.authenticate();

            let allProducts = [];
            let page = 1;
            let hasMore = true;
            let totalPages = 0;

            // Fase 1: Recolectar todos los productos con reintentos
            console.log('📦 Fase 1: Descargando productos de SIIGO...');
            while (hasMore) {
                try {
                    const { results, pagination } = await this.fetchWithRetry(page, 100);

                    if (results && results.length > 0) {
                        allProducts = allProducts.concat(results);
                        console.log(`   ✓ Página ${page}: ${results.length} productos (Total: ${allProducts.length})`);
                    }

                    if (!pagination || !results || results.length === 0 || pagination.page >= pagination.total_pages) {
                        hasMore = false;
                        totalPages = page;
                    } else {
                        page++;
                        // Pequeña pausa entre páginas para evitar rate limit
                        await this.sleep(1000);
                    }
                } catch (error) {
                    if (error.response?.status === 429) {
                        console.log(`\n⚠️  Rate limit final alcanzado después de ${page} páginas`);
                        console.log(`   Productos descargados: ${allProducts.length}`);
                        hasMore = false;
                    } else {
                        throw error;
                    }
                }
            }

            console.log(`\n✅ Descarga completada: ${allProducts.length} productos en ${totalPages} páginas\n`);

            // Fase 2: Sincronizar en lotes
            console.log('💾 Fase 2: Sincronizando productos a la base de datos...');

            const batches = [];
            for (let i = 0; i < allProducts.length; i += this.batchSize) {
                batches.push(allProducts.slice(i, i + this.batchSize));
            }

            let totalSynced = 0;
            let totalErrors = 0;

            for (let i = 0; i < batches.length; i++) {
                const batchNum = i + 1;
                console.log(`\n   Lote ${batchNum}/${batches.length} (${batches[i].length} productos)...`);

                const { synced, errors } = await this.syncBatch(batches[i]);
                totalSynced += synced;
                totalErrors += errors;

                console.log(`   ✓ Sincronizados: ${synced}, Errores: ${errors}`);

                // Pausa entre lotes para distribuir la carga
                if (i < batches.length - 1) {
                    await this.sleep(this.delayBetweenBatches);
                }
            }

            console.log('\n' + '='.repeat(60));
            console.log('🎉 SINCRONIZACIÓN COMPLETADA');
            console.log('='.repeat(60));
            console.log(`📊 Total de productos: ${allProducts.length}`);
            console.log(`✅ Sincronizados correctamente: ${totalSynced}`);
            console.log(`❌ Errores: ${totalErrors}`);
            console.log('='.repeat(60) + '\n');

            process.exit(0);
        } catch (error) {
            console.error('\n❌ Error fatal:', error.message);
            process.exit(1);
        }
    }
}

// Ejecutar
const sync = new SmartSync();
sync.run();
