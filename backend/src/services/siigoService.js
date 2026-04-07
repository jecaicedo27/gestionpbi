const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');
const crypto = require('crypto');

function generateMovementHash(data) {
    const { date, documentNumber, sku, type, quantity } = data;
    const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : String(date).split('T')[0];
    const content = `${dateStr}|${documentNumber}|${sku}|${type}|${quantity}`;
    return crypto.createHash('md5').update(content).digest('hex');
}
require('dotenv').config();

class SiigoService {
    constructor() {
        this.client = axios.create({
            baseURL: process.env.SIIGO_API_URL || 'https://api.siigo.com/v1',
            headers: {
                'Content-Type': 'application/json',
                'Partner-Id': process.env.SIIGO_PARTNER_ID
            }
        });
        this.token = null;
    }

    async authenticate() {
        try {
            const response = await axios.post('https://api.siigo.com/auth', {
                username: process.env.SIIGO_USERNAME,
                access_key: process.env.SIIGO_ACCESS_KEY
            });
            this.token = response.data.access_token;
            this.client.defaults.headers['Authorization'] = `Bearer ${this.token}`;
            return this.token;
        } catch (error) {
            logger.error('Error authenticating with Siigo:', error.message);
            throw new Error('Siigo Authentication Failed');
        }
    }

    async getProducts(page = 1, pageSize = 20) {
        if (!this.token) await this.authenticate();
        try {
            const response = await this.client.get(`/products?page=${page}&page_size=${pageSize}`);
            return {
                results: response.data.results,
                pagination: response.data.pagination
            };
        } catch (error) {
            logger.error(`Error fetching products from Siigo (Page ${page}):`, error.message);

            // Retry on 401 (Token)
            if (error.response && error.response.status === 401) {
                await this.authenticate();
                // Check if re-auth helped by retrying via recursive call (careful with infinite loop)
                // Better to just inline retry once or throw.
                // For simplicity, let's retry once more.
                try {
                    const retryResp = await this.client.get(`/products?page=${page}&page_size=${pageSize}`);
                    return { results: retryResp.data.results, pagination: retryResp.data.pagination };
                } catch (retryErr) {
                    throw retryErr;
                }
            }

            // Retry on 429 (Rate Limit) using simple delay
            if (error.response && error.response.status === 429) {
                logger.warn('⚠️ Rate limit (429) hit. Waiting 5s...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                const retryResp = await this.client.get(`/products?page=${page}&page_size=${pageSize}`);
                return { results: retryResp.data.results, pagination: retryResp.data.pagination };
            }

            throw error;
        }
    }

    // Legacy support for single product fetch (if used elsewhere)
    async getProduct(id) {
        if (!this.token) await this.authenticate();
        try {
            const response = await this.client.get(`/products/${id}`);
            return response.data;
        } catch (error) {
            console.error('Error fetching single product:', error.message);
            throw error;
        }
    }

    async syncAllProducts(io = null) {
        if (!this.token) await this.authenticate();
        logger.info('📡 Starting full inventory sync from SIIGO...');

        // Helper to safe emit
        const emitProgress = (data) => {
            if (io) io.emit('inventory:sync:progress', data);
        };

        try {
            emitProgress({ status: 'STARTING', message: 'Iniciando conexión con Siigo...', percentage: 5 });

            let allProducts = [];
            let page = 1;
            let hasMore = true;

            // Phase 1: Fetching
            while (hasMore) {
                try {
                    emitProgress({ status: 'FETCHING', message: `Descargando página ${page}...`, percentage: 10 + (page * 2) }); // Approx progress for fetching

                    const { results, pagination } = await this.getProducts(page, 50);

                    if (!results || results.length === 0) {
                        hasMore = false;
                        break;
                    }

                    allProducts = allProducts.concat(results);

                    if (!pagination || pagination.page >= pagination.total_pages) {
                        hasMore = false;
                    } else {
                        page++;
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                } catch (err) {
                    logger.error(`Failed to fetch page ${page}: ${err.message}`);
                    hasMore = false;
                }
            }

            logger.info(`Found ${allProducts.length} products to sync.`);
            emitProgress({ status: 'PROCESSING', message: `Procesando ${allProducts.length} productos...`, percentage: 50 });

            let synced = 0;
            let errors = 0;
            const total = allProducts.length;

            for (let i = 0; i < total; i++) {
                const product = allProducts[i];
                try {
                    await this.syncProduct(product);
                    synced++;
                } catch (error) {
                    errors++;
                    logger.error(`Error syncing product ${product.code}: ${error.message}`);
                }

                // Emit progress every 5 items or last one
                if (i % 5 === 0 || i === total - 1) {
                    const percent = 50 + Math.round(((i + 1) / total) * 50);
                    emitProgress({
                        status: 'PROCESSING',
                        message: `Sincronizando: ${product.name}`,
                        percentage: percent,
                        processed: i + 1,
                        total: total
                    });
                }
            }

            const result = { total, synced, errors };
            logger.info(`✅ Full sync complete. Result: ${JSON.stringify(result)}`);
            emitProgress({ status: 'COMPLETED', message: 'Sincronización completada', percentage: 100, result });

            return result;

        } catch (error) {
            logger.error(`❌ Sync error details: ${error.message} - Stack: ${error.stack}`);
            emitProgress({ status: 'ERROR', message: `Error: ${error.message}`, percentage: 0 });
            throw error;
        }
    }

    async request(endpoint, options = {}) {
        if (!this.token) await this.authenticate();
        try {
            const { method = 'GET', data = null, params = null } = options;
            const config = {
                method,
                url: endpoint,
                ...(data && { data }),
                ...(params && { params })
            };
            const response = await this.client.request(config);
            return response.data;
        } catch (error) {

            if (error.response && error.response.status === 401) {
                logger.warn(`[SiigoService] 401 on ${endpoint}. Retrying...`);
                await this.authenticate();

                const { method = 'GET', data = null, params = null } = options;
                const retryResponse = await this.client.request({
                    method,
                    url: endpoint,
                    ...(data && { data }),
                    ...(params && { params })
                });
                return retryResponse.data;
            }
            logger.error(`Error making request to ${endpoint}:`, error.message);
            throw error;
        }
    }

    async syncProduct(siigoProduct) {
        try {
            // Safe helper to get price
            const getPrice = (prod) => {
                if (prod.prices && prod.prices.length > 0) {
                    const firstPrice = prod.prices[0];
                    return firstPrice.price_list ? firstPrice.price_list[0].value : 0;
                }
                return 0;
            };

            const price = getPrice(siigoProduct);

            // Detect product type based on name
            const detectProductType = (name) => {
                const nameLower = name.toLowerCase();
                if (nameLower.includes('liquipops') || nameLower.includes('geniality')) return 'PERLA_EXPLOSIVA';
                if (nameLower.includes('syrup') || nameLower.includes('sirope')) return 'SYRUP';
                if (nameLower.includes('base') && nameLower.includes('citrica')) return 'BASE_CITRICA';
                return 'MATERIA_PRIMA';
            };

            // Extract attributes from name
            const productType = detectProductType(siigoProduct.name);
            const flavor = this.extractFlavor(siigoProduct.name);
            const size = this.extractSize(siigoProduct.name);
            // Assign Classification based on Group Name (User Request Rules)
            const assignClassification = (groupName) => {
                if (!groupName) return null;
                const g = groupName.toUpperCase();

                // 1. PRODUCTO TERMINADO
                if (g.includes('LIQUIPOPS') || g.includes('GENIALITY')) {
                    if (g.includes('PRODUCTOS EN PROCESO')) return 'PRODUCTO_EN_PROCESO';
                    // Exclude if explicitly marked as Raw Material in group name (though unlikely given rules)
                    return 'PRODUCTO_TERMINADO';
                }

                // 2. MATERIA PRIMA
                const rawMaterialGroups = [
                    'MATERIA PRIMA COLORES',
                    'MATERIA PRIMA ETIQUETAS Y SELLOS',
                    'MATERIA PRIMA FABRICACION 19%',
                    'MATERIA PRIMA FABRICACION 5%',
                    'MATERIA PRIMA SABORES',
                    'MATERIAL DE EMPAQUE'
                ];

                if (rawMaterialGroups.some(rm => g.includes(rm))) {
                    return 'MATERIA_PRIMA';
                }

                // 3. PRODUCTOS EN PROCESO (Specific Overrides)
                if (g.includes('PRODUCTOS EN PROCESO GENIALITY') || g.includes('PRODUCTOS EN PROCESO LIQUIPOPS')) {
                    return 'PRODUCTO_EN_PROCESO';
                }

                return null;
            };

            const groupName = this.mapGroupType(siigoProduct.account_group ? siigoProduct.account_group.name : null);
            const classification = assignClassification(siigoProduct.account_group ? siigoProduct.account_group.name : '');

            // Handle Group Relation
            let group = null;
            if (siigoProduct.account_group && siigoProduct.account_group.name) {
                group = await prisma.inventoryGroup.upsert({
                    where: { siigoId: siigoProduct.account_group.id.toString() },
                    update: {
                        name: siigoProduct.account_group.name
                    },
                    create: {
                        siigoId: siigoProduct.account_group.id.toString(),
                        name: siigoProduct.account_group.name,
                        type: groupName
                    }
                });
            } else {
                // Fallback group
                group = await prisma.inventoryGroup.upsert({
                    where: { siigoId: '0' },
                    update: {},
                    create: {
                        siigoId: '0',
                        name: 'Uncategorized',
                        type: 'OTHER'
                    }
                });
            }

            // Upsert Product
            const product = await prisma.product.upsert({
                where: { siigoId: siigoProduct.id },
                update: {
                    name: siigoProduct.name,
                    barcode: siigoProduct.additional_fields?.barcode || siigoProduct.code,
                    price: price,
                    currentStock: siigoProduct.available_quantity || 0,
                    groupId: group.id,
                    accountGroup: siigoProduct.account_group?.id || null,
                    flavor: flavor,
                    size: size,
                    active: siigoProduct.active,
                    taxClassification: siigoProduct.tax_classification,
                    taxIncluded: siigoProduct.tax_included,
                    taxes: siigoProduct.taxes || [],
                    warehouses: siigoProduct.warehouses || [],
                    classification: classification,
                    unit: siigoProduct.unit?.name || siigoProduct.unit_label || 'unidad',
                },
                create: {
                    siigoId: siigoProduct.id,
                    sku: siigoProduct.code,
                    type: productType,
                    name: siigoProduct.name,
                    barcode: siigoProduct.additional_fields?.barcode || siigoProduct.code,
                    price: price,
                    currentStock: siigoProduct.available_quantity || 0,
                    unit: siigoProduct.unit?.name || siigoProduct.unit_label || 'unidad',
                    groupId: group.id,
                    accountGroup: siigoProduct.account_group?.id || null,
                    flavor: flavor,
                    size: size,
                    active: siigoProduct.active,
                    taxClassification: siigoProduct.tax_classification,
                    taxIncluded: siigoProduct.tax_included,
                    taxes: siigoProduct.taxes || [],
                    warehouses: siigoProduct.warehouses || [],
                    classification: classification // New Field
                }
            });
            return product;
        } catch (error) {
            logger.error(`Error processing product ${siigoProduct.name}:`, error.message);
            // Don't throw - let sync continue with other products
        }
    }

    mapGroupType(categoryName) {
        if (!categoryName) return 'OTHER';
        // Simple mapping for now
        return 'DEFAULT';
    }

    extractFlavor(name) {
        const nameLower = name.toLowerCase();

        // 1. Try to extract from "Sabor a [Flavor]" pattern
        const match = nameLower.match(/sabor\s+a\s+([a-z\s]+?)(\s+x\s+|\s*$)/);
        if (match && match[1]) {
            // Clean up common extra words
            let flavor = match[1].trim();
            // Capitalize
            return flavor.charAt(0).toUpperCase() + flavor.slice(1);
        }

        // 2. Fallback to known list
        const commonFlavors = [
            'fresa', 'mango', 'maracuya', 'lito', 'coco', 'menta', 'litchi',
            'manzana verde', 'cereza', 'mora', 'sandia', 'limon', 'chicle',
            'curazao', 'granadina', 'tamarindo', 'cafe', 'chamoy', 'pink ice',
            'neutro', 'yogurt', 'blueberry', 'escarchador', 'liquimon'
        ];

        const found = commonFlavors.find(f => nameLower.includes(f));
        if (found) {
            return found.charAt(0).toUpperCase() + found.slice(1);
        }
        return 'Original';
    }

    extractSize(name) {
        const nameLower = name.toLowerCase();

        // 1. Try "X 1150 GR" or "X 350 GR" pattern specific to Liquipops
        const sizeMatch = nameLower.match(/x\s+(\d+\.?\d*)\s*(gr|g|ml|kg|l)/);
        if (sizeMatch) {
            return `${sizeMatch[1]}${sizeMatch[2]}`.replace('gr', 'g');
        }

        // 2. Specific Known Sizes
        if (nameLower.includes('350g') || nameLower.includes('350 g')) return '350g';
        if (nameLower.includes('1150g') || nameLower.includes('1.150') || nameLower.includes('1150 g')) return '1150g';
        if (nameLower.includes('3400g') || nameLower.includes('3.4kg') || nameLower.includes('3.4 kg') || nameLower.includes('3400 g') || nameLower.includes('3400 gr')) return '3400g';

        if (nameLower.includes('360ml') || nameLower.includes('360 ml')) return '360ml';
        if (nameLower.includes('500ml') || nameLower.includes('500 ml')) return '500ml';
        if (nameLower.includes('1000ml') || nameLower.includes('1000 ml') || nameLower.includes('1 litro')) return '1000ml';

        return 'Estándar';
    }

    async getInvoices(page = 1, pageSize = 20, dateStart = null, dateEnd = null) {
        if (!this.token) await this.authenticate();
        try {
            let url = `/invoices?page=${page}&page_size=${pageSize}`;
            if (dateStart) url += `&date_start=${dateStart}`;
            if (dateEnd) url += `&date_end=${dateEnd}`;

            const response = await this.client.get(url);
            return {
                results: response.data.results,
                pagination: response.data.pagination
            };
        } catch (error) {
            logger.error(`Error fetching invoices from Siigo (Page ${page}):`, error.message);
            if (error.response && error.response.status === 429) {
                logger.warn('⚠️ Rate limit (429) hit fetching invoices. Waiting 5s...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                return this.getInvoices(page, pageSize, dateStart, dateEnd);
            }
            throw error;
        }
    }

    async syncInvoicesRange(dateStart, dateEnd, io = null) {
        if (!this.token) await this.authenticate();
        logger.info(`📡 Syncing Invoices from ${dateStart} to ${dateEnd}...`);

        const emitProgress = (data) => {
            if (io) io.emit('sales:sync:progress', data);
        };

        try {
            emitProgress({ status: 'STARTING', message: 'Iniciando sincronización de facturas...', percentage: 5 });

            let page = 1;
            let hasMore = true;
            let totalProcessed = 0;

            while (hasMore) {
                const { results, pagination } = await this.getInvoices(page, 50, dateStart, dateEnd);

                if (!results || results.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const invoice of results) {
                    await this.processInvoiceAsMovement(invoice);
                    totalProcessed++;
                }

                if (!pagination || pagination.page >= pagination.total_pages) {
                    hasMore = false;
                } else {
                    const percent = Math.min(95, 10 + Math.round((page / pagination.total_pages) * 85));
                    emitProgress({
                        status: 'SYNCING',
                        message: `Procesando página ${page} de ${pagination.total_pages}...`,
                        percentage: percent,
                        page,
                        totalPages: pagination.total_pages
                    });
                    page++;
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }

            logger.info(`✅ Sync complete. Processed ${totalProcessed} invoices.`);
            emitProgress({ status: 'COMPLETED', message: `Sincronización finalizada: ${totalProcessed} facturas procesadas.`, percentage: 100 });

            return { totalProcessed };
        } catch (error) {
            logger.error('Error in syncInvoicesRange:', error.message);
            emitProgress({ status: 'ERROR', message: `Error: ${error.message}`, percentage: 0 });
            throw error;
        }
    }

    async processInvoiceAsMovement(invoice) {
        try {
            const date = new Date(invoice.date);

            // Siigo invoice API only returns customer.identification (NIT), not customer.name
            // Look up the distributor name from local User table by NIT, then Siigo API
            let customerName = 'CLIENTE DESCONOCIDO';
            const customerIdentification = invoice.customer?.identification;
            if (customerIdentification) {
                // 1. Try local User table (distributors)
                const localUser = await prisma.user.findFirst({
                    where: { nit: customerIdentification },
                    select: { name: true }
                });
                if (localUser) {
                    customerName = localUser.name;
                } else {
                    // 2. Try Supplier table
                    const localSupplier = await prisma.supplier.findFirst({
                        where: { identification: customerIdentification },
                        select: { name: true }
                    });
                    if (localSupplier?.name) {
                        customerName = localSupplier.name;
                    } else {
                        // 3. Fallback: query Siigo customers API by identification
                        try {
                            const res = await this.client.get('/customers', {
                                params: { identification: customerIdentification, page: 1, page_size: 1 }
                            });
                            const siigoCustomer = res.data?.results?.[0];
                            if (siigoCustomer?.name) {
                                const sName = Array.isArray(siigoCustomer.name)
                                    ? siigoCustomer.name.filter(Boolean).join(' ')
                                    : siigoCustomer.name;
                                customerName = sName || `NIT ${customerIdentification}`;
                            }
                        } catch (_err) {
                            // Ignore — use NIT as fallback
                            customerName = `NIT ${customerIdentification}`;
                        }
                    }
                }
            }

            // Siigo document ID + consecutive as unique reference
            const documentNumber = `${invoice.document.id}-${invoice.number}`;

            if (invoice.items && invoice.items.length > 0) {
                for (const item of invoice.items) {
                    // Find product by SKU
                    const product = await prisma.product.findUnique({
                        where: { sku: item.code }
                    });

                    if (product) {
                        const movementId = generateMovementHash({
                            date,
                            documentNumber,
                            sku: item.code,
                            type: 'VTA',
                            quantity: item.quantity
                        });

                        await prisma.movement.upsert({
                            where: { id: movementId },
                            update: {
                                quantity: item.quantity,
                                date: date,
                                productId: product.id,
                                customerName: customerName,
                                source: 'SIIGO'
                            },
                            create: {
                                id: movementId,
                                type: 'VTA',
                                date: date,
                                productId: product.id,
                                quantity: item.quantity,
                                documentNumber: documentNumber,
                                customerName: customerName,
                                source: 'SIIGO'
                            }
                        });
                    }
                }
            }
        } catch (error) {
            logger.error(`Error processing invoice ${invoice.number}:`, error.message);
        }
    }

    async createInvoice(order) {
        try {
            await this.authenticate();

            // ─── Configuration ───
            // Read document type from system config (FV-1=9314 testing, FV-2=28531 production)
            const sysConfig = await prisma.systemSettings.findUnique({ where: { key: 'PRODUCTION_CONFIG' } });
            const DOCUMENT_ID = parseInt(sysConfig?.value?.siigoDocumentType) || 9314;
            const SELLER_ID = 240;     // Gerencia
            const DISCOUNT_PERCENT = parseFloat(order.distributor?.discountPercent) || 34.8;
            const PAYMENT_DAYS = 30;

            const RETE_FUENTE_2_5 = 5014;      // Retefuente 2.5% — always applied
            const PAYMENT_CLIENTES_NAC = 10079; // Clientes Nacionales (Crédito)

            // ─── Customer (distributor) ───
            const nit = order.distributor?.nit || order.distributor?.username;
            const idType = order.distributor?.idType || '13'; // '13'=NIT, '12'=Cédula
            if (!nit) {
                throw { message: 'El distribuidor no tiene NIT configurado', error: 'NIT_REQUIRED' };
            }

            // ─── Items — use each product's own taxes from Siigo sync ───
            const items = order.items.map(item => {
                const quantity = item.allocatedQty || item.requestedQty || 0;

                // Get product taxes from DB (synced from Siigo)
                const productTaxes = Array.isArray(item.product?.taxes) ? item.product.taxes : [];

                // ── Tax-included price correction ──────────────────────────────────────
                // Siigo stores "taxIncluded" products with their consumer price (IVA + other
                // percentage taxes already embedded). The API expects the NET BASE price
                // (before taxes), so we strip those taxes out.
                // Value-based taxes (e.g., Bebidas Azucaradas / IBUA) ARE also embedded in
                // the consumer price, and must be subtracted linearly BEFORE dividing by
                // the percentage tax divisor.
                let unitPrice = item.product?.price || 0;
                if (item.product?.taxIncluded) {
                    // 1. Subtract fixed-value taxes
                    const fixedTaxesTotal = productTaxes
                        .filter(t => t.rate > 0 && t.milliliters > 0)
                        .reduce((sum, t) => sum + (t.rate * (t.milliliters / 100)), 0);
                    
                    unitPrice -= fixedTaxesTotal;

                    // 2. Divide by percentage-based taxes
                    const taxDivisor = 1 + productTaxes
                        .filter(t => t.type !== 'Retefuente' && (t.percentage || 0) > 0)
                        .reduce((sum, t) => sum + (t.percentage / 100), 0);
                        
                    unitPrice = Math.round((unitPrice / taxDivisor) * 100) / 100;
                }

                // Map to Siigo format: [{id: taxId}] — use product's own taxes + ReteFuente (conditional)
                const applyRete = order.distributor?.reteFuente === true; // opt-in: solo si es Persona Jurídica
                const itemTaxes = productTaxes.map(t => ({ id: t.id }));
                if (applyRete && !itemTaxes.find(t => t.id === RETE_FUENTE_2_5)) {
                    itemTaxes.push({ id: RETE_FUENTE_2_5 });
                }

                const productName = item.product?.name || '';
                
                // Regla de Negocio: LIQUIMON jamás tiene descuento
                let rowDiscount = DISCOUNT_PERCENT;
                if ((item.product?.sku || '').toUpperCase().includes('LIQUIMON')) {
                    rowDiscount = 0;
                }

                logger.info(`   📦 ${item.product?.sku} | ${productName.substring(0, 40)} | qty: ${quantity} | base: $${unitPrice.toLocaleString('es-CO')} | desc: ${rowDiscount}% | taxes: [${itemTaxes.map(t => t.id).join(',')}]`);

                return {
                    code: item.product?.sku,
                    description: productName,
                    quantity,
                    price: unitPrice,
                    discount: rowDiscount,
                    taxes: itemTaxes
                };
            });

            // ─── Calculate approximate total for payment (rounded to 2 decimals) ───
            // ReteFuente IS subtracted from the invoice total (it's a withholding)
            const r2 = v => Math.round(v * 100) / 100;
            let totalAPagar = 0;
            for (const item of items) {
                const lineGross = item.price * item.quantity;
                const lineDiscount = r2(lineGross * ((item.discount || 0) / 100));  // use per-item discount (0% for LIQUIMON)
                const lineNet = r2(lineGross - lineDiscount);
                
                // Sum taxes for this line
                const origProduct = order.items.find(i => i.product?.sku === item.code)?.product;
                const origTaxes = Array.isArray(origProduct?.taxes) ? origProduct.taxes : [];
                let lineTaxes = 0;
                let lineRete = 0;
                
                for (const tx of origTaxes) {
                    if (tx.percentage > 0) {
                        const taxAmt = r2(lineNet * (tx.percentage / 100));
                        if (tx.type === 'Retefuente') {
                            lineRete += taxAmt;
                        } else {
                            lineTaxes += taxAmt;
                        }
                    } else if (tx.rate > 0 && tx.milliliters > 0) {
                        // By-value tax (Bebidas azucaradas): rate is per 100ml
                        // So per unit = rate × (milliliters / 100), then × quantity
                        lineTaxes += r2(tx.rate * (tx.milliliters / 100) * item.quantity);
                    }
                }
                // Add ReteFuente 2.5% only if distributor is Persona Jurídica
                const _applyRete = order.distributor?.reteFuente === true; // opt-in: solo si es Persona Jurídica
                if (_applyRete && !origTaxes.find(t => t.type === 'Retefuente')) {
                    lineRete += r2(lineNet * 0.025);
                }
                
                totalAPagar += r2(lineNet + lineTaxes - lineRete);
            }
            totalAPagar = r2(totalAPagar);

            // Due date
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + PAYMENT_DAYS);

            // ─── Build lot traceability for invoice observations ───
            const lotLines = order.items.map(item => {
                const lots = [...new Set((item.pickingItems || []).map(pi => pi.lotNumber).filter(Boolean))];
                if (!lots.length) return null;
                return `${item.product?.sku}: ${lots.join('/')}`;
            }).filter(Boolean);
            const lotsText = lotLines.length ? ` | Lotes: ${lotLines.join(' | ')}` : '';
            const observations = `Pedido: ${order.orderNumber}${lotsText}`.substring(0, 250);

            // ─── Build Payload ───
            const payload = {
                document: { id: DOCUMENT_ID },
                date: new Date().toISOString().split('T')[0],
                customer: {
                    identification: nit,
                    branch_office: 0
                },
                seller: SELLER_ID,
                items,
                payments: [
                    {
                        id: PAYMENT_CLIENTES_NAC,
                        value: totalAPagar,
                        due_date: dueDate.toISOString().split('T')[0]
                    }
                ],
                observations
            };

            logger.info(`📝 Creating Siigo Invoice | Order: ${order.orderNumber} | NIT: ${nit} | Items: ${items.length} | Payment: $${totalAPagar.toLocaleString('es-CO')}`);

            const response = await this.client.post('/invoices', payload);

            logger.info(`✅ Siigo Invoice created: ${response.data.name || response.data.number} | ID: ${response.data.id}`);
            return response.data;

        } catch (error) {
            const errorBody = error.response?.data;
            logger.error(`❌ Error creating Siigo invoice for Order ${order?.orderNumber}:`, JSON.stringify(errorBody || error.message));

            const siigoErrors = errorBody?.Errors || [];
            const msg = siigoErrors[0]?.Message || errorBody?.Message || error.error || 'Error de validación en SIIGO';

            throw {
                message: 'Error creando factura en SIIGO',
                error: msg,
                details: siigoErrors
            };
        }
    }

    /**
     * Get invoice PDF from Siigo by invoice UUID
     */
    async getInvoicePdf(invoiceId) {
        await this.authenticate();
        const response = await this.client.get(`/invoices/${invoiceId}/pdf`, {
            responseType: 'arraybuffer'
        });
        return response.data;
    }

    /**
     * Get suppliers from Siigo (type=Supplier)
     * @param {string} search - Optional name filter
     */
    async getSuppliers(search) {
        if (!this.token) await this.authenticate();
        try {
            let allSuppliers = [];
            let page = 1;
            let hasMore = true;

            while (hasMore) {
                let response;
                // Retry loop for rate limits (429) — Siigo resets limit every ~60s
                for (let attempt = 0; attempt < 5; attempt++) {
                    try {
                        response = await this.client.get(`/customers?type=Supplier&page=${page}&page_size=100`);
                        break; // success
                    } catch (err) {
                        if (err.response?.status === 429 && attempt < 4) {
                            const wait = 30 + (attempt * 10); // 30s, 40s, 50s, 60s
                            logger.warn(`⚠️ Siigo rate limit on suppliers page ${page}, waiting ${wait}s (attempt ${attempt + 1}/5)...`);
                            await new Promise(resolve => setTimeout(resolve, wait * 1000));
                        } else if (err.response?.status === 401) {
                            await this.authenticate();
                        } else {
                            throw err;
                        }
                    }
                }

                if (!response) throw new Error('Siigo supplier sync failed after retries');

                const results = response.data.results || [];

                // Stop if empty page (no more data)
                if (results.length === 0) {
                    hasMore = false;
                    break;
                }

                allSuppliers = allSuppliers.concat(results);
                logger.info(`📡 Suppliers page ${page}: ${results.length} fetched (${allSuppliers.length} total)`);

                if (!response.data.pagination || response.data.pagination.page >= response.data.pagination.total_pages) {
                    hasMore = false;
                } else {
                    page++;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            // Map to simplified format
            let suppliers = allSuppliers.map(s => ({
                id: s.id,
                name: Array.isArray(s.name) ? s.name.filter(Boolean).join(' ') : s.name,
                identification: s.identification,
                email: s.contacts?.[0]?.email || null,
                phone: s.contacts?.[0]?.phone?.number || null
            }));

            // Filter by search
            if (search) {
                const q = search.toLowerCase();
                suppliers = suppliers.filter(s =>
                    s.name.toLowerCase().includes(q) ||
                    (s.identification && s.identification.includes(q))
                );
            }

            return suppliers;
        } catch (error) {
            logger.error('Error fetching suppliers from Siigo:', error.message);
            throw error;
        }
    }

    /**
     * Get raw materials from local DB (excludes process products).
     * Uses local Product table synced from Siigo.
     */
    async getRawMaterials(search) {
        const where = {
            sku: { not: { startsWith: 'PROCE' } },
            active: true,
            OR: [
                { classification: 'MATERIA_PRIMA' },
                { classification: null } // Some may not have classification yet
            ]
        };

        if (search) {
            where.AND = [{
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { sku: { contains: search, mode: 'insensitive' } }
                ]
            }];
        }

        const products = await prisma.product.findMany({
            where,
            select: { id: true, sku: true, name: true, unit: true },
            orderBy: { name: 'asc' },
            take: 100
        });

        return products;
    }

    /**
     * Siigo Tax ID mapping
     */
    _getTaxId(type, percentage) {
        const map = {
            'IVA_19': 5008, 'IVA_5': 5009,
            'RETE_11': 5010, 'RETE_10': 5011, 'RETE_6': 5012,
            'RETE_4': 5013, 'RETE_2.5': 5014
        };
        if (type === 'IVA') return map[`IVA_${percentage}`] || null;
        if (type === 'RETE') return map[`RETE_${percentage}`] || null;
        return null;
    }

    _extractTrailingNumber(value) {
        const matches = String(value ?? '').match(/\d+/g);
        if (!matches || matches.length === 0) return null;
        const parsed = parseInt(matches[matches.length - 1], 10);
        return Number.isFinite(parsed) ? parsed : null;
    }

    async _mapPurchaseLookupResult(purchase) {
        const supplierIdentification = purchase.supplier?.identification || null;
        let supplierName = 'Desconocido';

        if (supplierIdentification) {
            const localSupplier = await prisma.supplier.findFirst({
                where: { identification: supplierIdentification },
                select: { name: true }
            });
            if (localSupplier) supplierName = localSupplier.name;
            else supplierName = `NIT ${supplierIdentification}`;
        }

        const items = (purchase.items || []).map(item => ({
            code: item.code,
            description: item.description,
            quantity: item.quantity,
            price: item.price,
            total: (item.quantity || 0) * (item.price || 0),
            taxes: item.taxes || []
        }));

        const subtotal = items.reduce((sum, i) => sum + i.total, 0);
        const taxTotals = {};
        items.forEach(item => {
            (item.taxes || []).forEach(t => {
                const key = t.name || t.type || `Tax ${t.id}`;
                if (!taxTotals[key]) taxTotals[key] = { name: key, percentage: t.percentage, value: 0, type: t.type || '' };
                taxTotals[key].value += (t.value || 0);
            });
        });

        return {
            siigoId: purchase.id,
            number: purchase.number,
            name: purchase.name,
            date: purchase.date,
            dueDate: purchase.due_date || null,
            currency: purchase.currency?.code || 'COP',
            supplier: {
                name: supplierName,
                identification: supplierIdentification
            },
            items,
            subtotal,
            taxBreakdown: Object.values(taxTotals),
            total: purchase.total || subtotal,
            observations: purchase.observations || '',
            providerInvoice: purchase.provider_invoice || null,
            paymentMethod: purchase.payments?.[0]?.name || null,
            _raw: {
                documentId: purchase.document?.id,
                documentName: purchase.document?.name,
                costCenter: purchase.cost_center,
                payments: purchase.payments
            }
        };
    }

    /**
     * Get Purchase Invoice from Siigo by consecutive number
     * Used for cross-validation: accounting enters the Siigo purchase number
     * and the system fetches the real data to verify it matches the reception.
     * @param {string|number} number - The consecutive number of the purchase (e.g. 2601)
     * @returns {Object} Clean purchase data for frontend display
     */
    async getPurchaseByNumber(number) {
        if (!this.token) await this.authenticate();
        const targetNumber = this._extractTrailingNumber(number);
        if (!targetNumber) return null;
        try {
            const pageSize = 100;
            let page = 1;

            while (true) {
                // Siigo is currently ignoring the purchase number filter, so we
                // scan paginated results until we find the exact consecutive.
                const response = await this.client.get('/purchases', {
                    params: {
                        number: targetNumber,
                        page,
                        page_size: pageSize
                    }
                });

                const results = response.data.results || [];
                if (results.length === 0) return null;

                const purchase = results.find(item => this._extractTrailingNumber(item.number ?? item.name) === targetNumber);
                if (purchase) return this._mapPurchaseLookupResult(purchase);

                const pagination = response.data.pagination || {};
                const totalResults = Number(pagination.total_results) || 0;
                const effectivePageSize = Number(pagination.page_size) || pageSize;
                const totalPages = totalResults > 0 ? Math.ceil(totalResults / effectivePageSize) : page;
                if (page >= totalPages) return null;
                page += 1;
            }
        } catch (error) {
            if (error.response && error.response.status === 401) {
                await this.authenticate();
                return this.getPurchaseByNumber(number);
            }
            if (error.response && error.response.status === 429) {
                logger.warn('⚠️ Rate limit (429) on purchases lookup. Waiting 3s...');
                await new Promise(resolve => setTimeout(resolve, 3000));
                return this.getPurchaseByNumber(number);
            }
            logger.error(`Error fetching purchase #${number} from Siigo:`, error.message);
            throw error;
        }
    }

    /**
     * Create Purchase Invoice (Factura de Compra) in Siigo
     * @param {Object} params
     * @param {Object} params.reception - Reception with items
     * @param {Object} params.supplier - Supplier with tax config
     * @param {Object} params.costs - {itemId: {unitCostPerKg: number}}
     * @param {string} params.providerInvoiceNumber - Provider's invoice number
     * @param {string} params.providerInvoicePrefix - Provider's invoice prefix
     */
    async createPurchaseInvoice({ reception, supplier, costs, providerInvoiceNumber, providerInvoicePrefix }) {
        try {
            await this.authenticate();

            const ivaRate = supplier.ivaRate || 0;
            const reteRate = supplier.reteFuenteRate || 0;
            const paymentDays = supplier.paymentTermDays || 30;

            // Build items
            const items = reception.items.map(ri => {
                const itemCost = costs[ri.orderItemId] || {};
                const quantityKg = ri.quantityReceived / 1000; // grams to kg
                const unitPrice = itemCost.unitCostPerKg || 0;
                const lineTotal = unitPrice * quantityKg;

                const taxes = [];
                if (ivaRate > 0) {
                    const taxId = this._getTaxId('IVA', ivaRate);
                    if (taxId) taxes.push({ id: taxId });
                }

                return {
                    code: ri.orderItem?.siigoProductCode || ri.orderItem?.product?.sku || 'MP0000',
                    description: ri.orderItem?.siigoProductName || 'Materia prima',
                    quantity: quantityKg,
                    price: unitPrice,
                    discount: 0,
                    taxes
                };
            });

            // Retentions
            const retentions = [];
            if (reteRate > 0) {
                const reteId = this._getTaxId('RETE', reteRate);
                if (reteId) retentions.push({ id: reteId });
            }

            // Calculate total for payment
            const subtotal = items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
            const ivaAmount = subtotal * (ivaRate / 100);
            const reteAmount = subtotal * (reteRate / 100);
            const total = subtotal + ivaAmount - reteAmount;

            // Due date
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + paymentDays);

            const payload = {
                document: { id: 9319 }, // FC - Factura de Compra
                date: new Date().toISOString().split('T')[0],
                cost_center: 909, // PRODUCCIÓN - POPPING
                supplier: {
                    identification: supplier.identification,
                    branch_office: 0
                },
                provider_invoice: {
                    prefix: providerInvoicePrefix || '',
                    number: providerInvoiceNumber || ''
                },
                items,
                retentions,
                payments: [
                    {
                        id: 2149, // Proveedores Nacionales
                        value: total,
                        due_date: dueDate.toISOString().split('T')[0]
                    }
                ]
            };

            logger.info(`📝 Creating Siigo Purchase Invoice | Supplier: ${supplier.name} | Total: $${total.toLocaleString()}`);
            const response = await this.client.post('/purchases', payload);
            logger.info(`✅ Purchase Invoice created: ${response.data.name} | ID: ${response.data.id}`);
            return response.data;
        } catch (error) {
            const errorDetails = error.response ? error.response.data : error.message;
            logger.error(`❌ Error creating purchase invoice:`, JSON.stringify(errorDetails));

            const msg = error.response?.data?.Errors?.[0]?.Message || 'Error de validación en SIIGO';
            const validationErrors = error.response?.data?.Errors || [];
            throw {
                message: 'Error creando factura de compra en SIIGO',
                error: msg,
                details: validationErrors,
                siigoPayload: payload
            };
        }
    }

    /**
     * Create a Siigo Electronic Credit Note (NC-2) from a PQR record.
     * Uses the same price/tax logic as createInvoice.
     * @param {Object} pqr — Prisma PQR with items (including product.price/taxes/taxIncluded/sku/name) and user (nit, name)
     */
    async createCreditNote(pqr) {
        try {
            await this.authenticate();

            // ─── Credit note NC: use pqr.user idType and discountPercent ──
            const NC_DOCUMENT_ID   = 28532;  // NC-2 — Nota Crédito Electrónica

            const SELLER_ID        = 240;    // Gerencia
            const DISCOUNT_PERCENT = parseFloat(pqr.user?.discountPercent) || 34.8;
            const RETE_FUENTE_2_5  = 5014;   // Retefuente 2.5%

            // ── Customer (distributor) ──
            const nit = pqr.user?.nit;
            const idType = pqr.user?.idType || '13'; // '13'=NIT, '12'=Cédula
            if (!nit) {
                throw { message: 'El distribuidor no tiene NIT configurado', error: 'NIT_REQUIRED' };
            }

            logger.info(`\n🧾 [createCreditNote] PQR: ${pqr.ticketNumber} → NC-2 para NIT ${nit}`);

            // ── Items — same tax/price logic as createInvoice ──
            const items = pqr.items.map(item => {
                const quantity     = item.quantity || 0;
                const productTaxes = Array.isArray(item.product?.taxes) ? item.product.taxes : [];

                let unitPrice = item.product?.price || 0;
                if (item.product?.taxIncluded) {
                    const taxDivisor = 1 + productTaxes
                        .filter(t => t.type !== 'Retefuente' && (t.percentage || 0) > 0)
                        .reduce((sum, t) => sum + (t.percentage / 100), 0);
                    unitPrice = Math.round((unitPrice / taxDivisor) * 100) / 100;
                }

                const itemTaxes = productTaxes.map(t => ({ id: t.id }));
                if (!itemTaxes.find(t => t.id === RETE_FUENTE_2_5)) {
                    itemTaxes.push({ id: RETE_FUENTE_2_5 });
                }

                const productName = item.product?.name || item.product?.sku;
                
                // Regla de Negocio: LIQUIMON jamás tiene descuento
                let rowDiscount = DISCOUNT_PERCENT;
                if ((item.product?.sku || '').toUpperCase().includes('LIQUIMON')) {
                    rowDiscount = 0;
                }

                logger.info(`   📦 ${item.product?.sku} | qty: ${quantity} | base: $${unitPrice.toLocaleString('es-CO')} | desc: ${rowDiscount}% | taxes: [${itemTaxes.map(t => t.id).join(',')}]`);

                return {
                    code: item.product?.sku,
                    description: productName,
                    quantity,
                    price: unitPrice,
                    discount: rowDiscount,
                    taxes: itemTaxes
                };
            }).filter(i => {
                if (!i.code) {
                    logger.warn(`   ⚠️ Item excluido de NC — sin producto vinculado (qty: ${i.quantity})`);
                }
                return i.quantity > 0 && i.code;
            });

            const excluded = pqr.items.length - items.length;
            if (excluded > 0) {
                logger.warn(`⚠️ [createCreditNote] ${excluded} item(s) excluidos por no tener producto vinculado en la DB`);
            }


            if (items.length === 0) {
                throw { message: 'El PQR no tiene items válidos con producto configurado', error: 'NO_ITEMS' };
            }

            // ── Calcular total NC (mismo algoritmo que createInvoice) ──
            const r2 = v => Math.round(v * 100) / 100;
            const PAYMENT_CLIENTES_NAC = 10079; // Clientes Nacionales (Crédito/NC)
            let totalAPagar = 0;

            for (const item of items) {
                const lineGross    = r2(item.price * item.quantity);
                const lineDiscount = r2(lineGross * (DISCOUNT_PERCENT / 100));
                const lineNet      = r2(lineGross - lineDiscount);

                // Busca taxes originales del producto para calcular impuestos en la línea
                const origProduct = pqr.items.find(i => i.product?.sku === item.code)?.product;
                const origTaxes   = Array.isArray(origProduct?.taxes) ? origProduct.taxes : [];

                let lineTaxes = 0, lineRete = 0;
                for (const tx of origTaxes) {
                    if ((tx.percentage || 0) > 0) {
                        const txAmt = r2(lineNet * (tx.percentage / 100));
                        if (tx.type === 'Retefuente') lineRete += txAmt;
                        else lineTaxes += txAmt;
                    } else if ((tx.rate || 0) > 0 && (tx.milliliters || 0) > 0) {
                        lineTaxes += r2(tx.rate * (tx.milliliters / 100) * item.quantity);
                    }
                }
                if (!origTaxes.find(t => t.type === 'Retefuente')) {
                    lineRete += r2(lineNet * 0.025); // ReteFuente 2.5% siempre
                }
                totalAPagar += r2(lineNet + lineTaxes - lineRete);
            }
            totalAPagar = r2(totalAPagar);
            logger.info(`   💰 Total NC: $${totalAPagar.toLocaleString('es-CO')}`);

            const today = new Date().toISOString().split('T')[0];
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 30);

            const payload = {
                document: { id: NC_DOCUMENT_ID },
                date: today,
                customer: {
                    identification: nit.replace(/[^0-9]/g, ''),
                    branch_office: 0
                },
                seller: SELLER_ID,
                reason: 5,  // Motivo DIAN 5 = Otros (no requiere factura de referencia)
                observations: `Nota crédito PQR ${pqr.ticketNumber}${pqr.reportedByName ? ` — ${pqr.reportedByName}` : ''}`,
                items
            };



            logger.info(`   📤 Payload NC:\n${JSON.stringify(payload, null, 2)}`);

            const response = await this.client.post('/credit-notes', payload);

            logger.info(`✅ [createCreditNote] NC creada: ${response.data.name} (ID: ${response.data.id})`);
            return response.data;
        } catch (error) {
            const errorDetails = error.response ? error.response.data : error.message;
            logger.error(`❌ [createCreditNote] Error:`, JSON.stringify(errorDetails));

            if (error.error) throw error; // Already formatted

            const msg = error.response?.data?.Errors?.[0]?.Message || 'Error de validación en Siigo';
            throw {
                message: 'Error creando nota crédito en Siigo',
                error: msg,
                details: error.response?.data?.Errors || [],
                siigoPayload: error.config?.data
            };
        }
    }
}

module.exports = new SiigoService();
