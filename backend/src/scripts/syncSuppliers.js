/**
 * syncSuppliers.js — Pull all suppliers from Siigo into local DB
 * Saves per-page to avoid losing data on rate limit errors.
 * Run: node src/scripts/syncSuppliers.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
require('dotenv').config();

async function syncSuppliers() {
    const siigo = require('../services/siigoService');
    if (!siigo.token) await siigo.authenticate();

    console.log('🔄 Syncing suppliers from Siigo...');

    let page = 1;
    let hasMore = true;
    let totalSaved = 0;
    let errors = 0;

    while (hasMore) {
        try {
            console.log(`  📄 Page ${page}...`);
            const response = await siigo.client.get(`/customers?type=Supplier&page=${page}&page_size=100`);
            const results = response.data.results || [];

            if (results.length === 0) {
                hasMore = false;
                break;
            }

            // Save each supplier immediately
            for (const s of results) {
                try {
                    const name = Array.isArray(s.name) ? s.name.filter(Boolean).join(' ') : (s.name || 'Sin nombre');
                    await prisma.supplier.upsert({
                        where: { siigoId: String(s.id) },
                        update: {
                            name,
                            identification: s.identification || null,
                            email: s.contacts?.[0]?.email || null,
                            phone: s.contacts?.[0]?.phone?.number || null,
                            active: true
                        },
                        create: {
                            siigoId: String(s.id),
                            name,
                            identification: s.identification || null,
                            email: s.contacts?.[0]?.email || null,
                            phone: s.contacts?.[0]?.phone?.number || null,
                            type: 'Supplier',
                            active: true
                        }
                    });
                    totalSaved++;
                } catch (err) {
                    errors++;
                    if (errors <= 3) console.error(`    ❌ Error: ${err.message}`);
                }
            }

            console.log(`    ✅ Saved ${results.length} (total: ${totalSaved})`);

            // Check pagination
            if (!response.data.pagination || response.data.pagination.page >= response.data.pagination.total_pages) {
                hasMore = false;
            } else {
                page++;
                // Wait 500ms to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } catch (err) {
            if (err.response?.status === 429) {
                console.log(`    ⏳ Rate limited at page ${page}, waiting 10s...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
                // Retry same page
            } else {
                console.error(`    ❌ Fatal error at page ${page}:`, err.message);
                hasMore = false;
            }
        }
    }

    const total = await prisma.supplier.count();
    console.log(`\n✅ Sync complete: ${totalSaved} saved, ${errors} errors`);
    console.log(`📊 Total suppliers in DB: ${total}`);

    await prisma.$disconnect();
}

syncSuppliers().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
