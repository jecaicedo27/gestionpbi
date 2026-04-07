/**
 * syncInvoiceItems.js
 * Downloads all Siigo invoice line-items into SiigoInvoiceItem table
 * for exact fiscal reporting.
 * 
 * Usage: node src/scripts/syncInvoiceItems.js [startDate] [endDate]
 * Example: node src/scripts/syncInvoiceItems.js 2025-01-01 2025-12-31
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const siigo = require('../services/siigoService');
const logger = require('../utils/logger');

async function resolveCustomerName(customerIdentification) {
    if (!customerIdentification) return 'CLIENTE DESCONOCIDO';

    // 1. Local User table (distributors)
    const localUser = await prisma.user.findFirst({
        where: { nit: customerIdentification },
        select: { name: true }
    });
    if (localUser) return localUser.name;

    // 2. Supplier table
    const localSupplier = await prisma.supplier.findFirst({
        where: { identification: customerIdentification },
        select: { name: true }
    });
    if (localSupplier?.name) return localSupplier.name;

    // 3. Siigo customers API
    try {
        const res = await siigo.client.get('/customers', {
            params: { identification: customerIdentification, page: 1, page_size: 1 }
        });
        const sc = res.data?.results?.[0];
        if (sc?.name) {
            const sName = Array.isArray(sc.name) ? sc.name.filter(Boolean).join(' ') : sc.name;
            return sName || `NIT ${customerIdentification}`;
        }
    } catch (_) {}

    return `NIT ${customerIdentification}`;
}

async function syncInvoiceItems(dateStart, dateEnd) {
    console.log(`\n📡 Syncing Siigo invoice items: ${dateStart} → ${dateEnd}\n`);

    await siigo.authenticate();
    console.log('✅ Authenticated with Siigo');

    // Cache customer names to avoid repeated lookups
    const nameCache = {};

    let page = 1;
    let hasMore = true;
    let totalItems = 0;
    let totalInvoices = 0;

    while (hasMore) {
        const { results, pagination } = await siigo.getInvoices(page, 50, dateStart, dateEnd);

        if (!results || results.length === 0) {
            hasMore = false;
            break;
        }

        for (const invoice of results) {
            const invoiceNumber = invoice.number;
            const docPrefix = invoice.prefix ? `${invoice.prefix}-${invoice.document?.id || ''}` : `FV-${invoice.document?.id || '1'}`;
            const invoiceDate = new Date(invoice.date);
            const customerNit = invoice.customer?.identification || 'N/A';

            // Resolve customer name (cached)
            if (!nameCache[customerNit]) {
                nameCache[customerNit] = await resolveCustomerName(customerNit);
            }
            const customerName = nameCache[customerNit];

            if (!invoice.items || invoice.items.length === 0) continue;

            for (const item of invoice.items) {
                const ivaTax = item.taxes?.find(t => t.type === 'IVA');
                const ultraTax = item.taxes?.find(t => t.type === 'Comestibles ultraprocesados');
                const bebTax = item.taxes?.find(t => t.type === 'Bebidas azucaradas');

                const qty = item.quantity || 0;
                const unitPrice = item.price || 0;
                const discPercent = item.discount?.percentage || 0;
                const discValue = item.discount?.value || 0;
                const subtotal = (unitPrice * qty) - discValue;

                try {
                    await prisma.siigoInvoiceItem.upsert({
                        where: {
                            unique_invoice_item: {
                                invoiceNumber,
                                documentPrefix: docPrefix,
                                itemCode: item.code || 'N/A',
                                quantity: qty
                            }
                        },
                        update: {
                            invoiceDate,
                            customerNit,
                            customerName,
                            itemDescription: item.description || '',
                            unitPrice,
                            discountPercent: discPercent,
                            discountValue: discValue,
                            subtotal,
                            ivaPercent: ivaTax?.percentage || 0,
                            ivaValue: ivaTax?.value || 0,
                            ultraPercent: ultraTax?.percentage || 0,
                            ultraValue: ultraTax?.value || 0,
                            bebidasValue: bebTax?.value || 0,
                            lineTotal: item.total || 0,
                            syncedAt: new Date()
                        },
                        create: {
                            invoiceNumber,
                            documentPrefix: docPrefix,
                            invoiceDate,
                            customerNit,
                            customerName,
                            itemCode: item.code || 'N/A',
                            itemDescription: item.description || '',
                            quantity: qty,
                            unitPrice,
                            discountPercent: discPercent,
                            discountValue: discValue,
                            subtotal,
                            ivaPercent: ivaTax?.percentage || 0,
                            ivaValue: ivaTax?.value || 0,
                            ultraPercent: ultraTax?.percentage || 0,
                            ultraValue: ultraTax?.value || 0,
                            bebidasValue: bebTax?.value || 0,
                            lineTotal: item.total || 0
                        }
                    });
                    totalItems++;
                } catch (err) {
                    console.error(`  ⚠️ Error on invoice ${invoiceNumber} item ${item.code}:`, err.message);
                }
            }

            totalInvoices++;
        }

        const pct = pagination ? Math.round((page / pagination.total_pages) * 100) : 100;
        console.log(`  📄 Page ${page}/${pagination?.total_pages || '?'} — ${totalInvoices} invoices, ${totalItems} items (${pct}%)`);

        if (!pagination || pagination.page >= pagination.total_pages) {
            hasMore = false;
        } else {
            page++;
            // Rate limit protection
            await new Promise(resolve => setTimeout(resolve, 350));
        }
    }

    console.log(`\n✅ Sync complete: ${totalInvoices} invoices → ${totalItems} line items saved\n`);

    // Print fiscal summary
    const summary = await prisma.siigoInvoiceItem.aggregate({
        where: {
            invoiceDate: {
                gte: new Date(dateStart),
                lt: new Date(new Date(dateEnd).getTime() + 86400000)
            }
        },
        _sum: {
            subtotal: true,
            discountValue: true,
            ivaValue: true,
            ultraValue: true,
            bebidasValue: true,
            lineTotal: true
        }
    });

    const M = v => '$' + ((v || 0) / 1e6).toFixed(1) + 'M';
    console.log('=== RESUMEN FISCAL (datos Siigo) ===');
    console.log('Subtotal (base - desc):', M(summary._sum.subtotal));
    console.log('Descuentos:', M(summary._sum.discountValue));
    console.log('IVA:', M(summary._sum.ivaValue));
    console.log('Ultraprocesados:', M(summary._sum.ultraValue));
    console.log('Bebidas azucaradas:', M(summary._sum.bebidasValue));
    console.log('Total facturado:', M(summary._sum.lineTotal));
    console.log('===================================');

    return { totalInvoices, totalItems };
}

// CLI
const args = process.argv.slice(2);
const start = args[0] || '2025-01-01';
const end = args[1] || '2025-12-31';

syncInvoiceItems(start, end)
    .then(() => process.exit(0))
    .catch(err => { console.error('Fatal:', err); process.exit(1); });
