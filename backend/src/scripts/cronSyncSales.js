#!/usr/bin/env node
/**
 * Cron: Sync sales invoices from Siigo every hour.
 * Syncs the last 60 days of invoices to keep data fresh.
 * Usage: node cronSyncSales.js
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const siigoService = require('../services/siigoService');
const dataMiningService = require('../services/dataMiningService');

async function run() {
    const now = new Date();
    const dateEnd = now.toISOString().split('T')[0]; // Today
    // Sync last 60 days
    const start = new Date(now);
    start.setDate(start.getDate() - 60);
    const dateStart = start.toISOString().split('T')[0];

    console.log(`[${now.toLocaleString('es-CO')}] 📡 Sync ventas Siigo: ${dateStart} → ${dateEnd}`);

    try {
        const result = await siigoService.syncInvoicesRange(dateStart, dateEnd);
        console.log(`✅ ${result.totalProcessed || 0} facturas procesadas`);

        // Update velocities
        await dataMiningService.calculateVelocities();
        console.log('✅ Velocidades actualizadas');
    } catch (err) {
        console.error('❌ Error:', err.message);
    }

    process.exit(0);
}

run();
