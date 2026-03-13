const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const siigoService = require('../services/siigoService');
const dataMiningService = require('../services/dataMiningService');
const logger = require('../utils/logger');
const XLSX = require('xlsx');
const crypto = require('crypto');

/**
 * Creates a unique deterministic ID for a movement based on its content.
 */
function generateMovementHash(data) {
    const { date, documentNumber, sku, type, quantity } = data;
    // Format date as YYYY-MM-DD for consistency
    const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : String(date);
    const content = `${dateStr}|${documentNumber}|${sku}|${type}|${quantity}`;
    return crypto.createHash('md5').update(content).digest('hex');
}

exports.syncSales = async (req, res) => {
    const { dateStart, dateEnd } = req.body;

    if (!dateStart || !dateEnd) {
        return res.status(400).json({ error: 'Faltan parámetros dateStart y dateEnd (YYYY-MM-DD)' });
    }

    try {
        const io = req.app.get('io');
        // Initial sync in background or wait for it? 
        // For now let's wait but with progress via Socket.io
        const result = await siigoService.syncInvoicesRange(dateStart, dateEnd, io);

        // Trigger velocity update
        logger.info('🔄 Triggering velocity update after sales sync...');
        await dataMiningService.calculateVelocities().catch(err => logger.error('Async velocity update failed:', err));

        res.json({ success: true, ...result });
    } catch (error) {
        logger.error('Error syncing sales:', error.message);
        res.status(500).json({ error: 'Error sincronizando ventas con Siigo' });
    }
};

exports.uploadProductionMovements = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    try {
        const io = req.app.get('io');
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        // Columns based on standard "Movimiento.xlsx"
        // 0: Code, 1: Name, 2: Doc, 3: Date, 4: Entry, 5: Exit
        const COL_CODE = 0;
        const COL_DOC = 2;
        const COL_DATE = 3;
        const COL_ENTRY = 4;
        const COL_EXIT = 5;

        let processed = 0;
        let skipped = 0;
        const totalRows = data.length - 1; // minus header

        // Emit initial progress
        if (io) io.emit('production:upload:progress', { status: 'PROCESSING', current: 0, total: totalRows, processed: 0, skipped: 0, percentage: 0 });

        // Skip header
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const code = row[COL_CODE] ? String(row[COL_CODE]).trim() : null;
            const doc = row[COL_DOC] ? String(row[COL_DOC]).toUpperCase() : '';
            const dateStr = row[COL_DATE];

            if (!code || !dateStr || !doc.startsWith('NE')) {
                skipped++;
                // Emit progress every 100 skipped rows too
                if (io && (i % 100 === 0)) {
                    const pct = Math.round((i / totalRows) * 100);
                    io.emit('production:upload:progress', { status: 'PROCESSING', current: i, total: totalRows, processed, skipped, percentage: pct });
                }
                continue;
            }

            // Parse Date DD/MM/YYYY
            const [d, m, y] = dateStr.split('/');
            const date = new Date(`${y}-${m}-${d}`);

            const qtyEntry = parseFloat(row[COL_ENTRY]) || 0;
            const qtyExit = parseFloat(row[COL_EXIT]) || 0;

            // Find product
            const product = await prisma.product.findUnique({
                where: { sku: code }
            });

            if (!product) {
                skipped++;
                continue;
            }

            // Type 'PROD' for entries (Entry > 0), 'CONS' for exits (Exit > 0)
            const type = qtyEntry > 0 ? 'PROD' : 'CONS';
            const quantity = qtyEntry > 0 ? qtyEntry : qtyExit;

            // Generate content-based ID for deduplication
            const movementId = generateMovementHash({
                date,
                documentNumber: doc,
                sku: code,
                type,
                quantity
            });

            await prisma.movement.upsert({
                where: { id: movementId },
                update: {
                    quantity,
                    date,
                    productId: product.id,
                    source: 'EXCEL'
                },
                create: {
                    id: movementId,
                    type,
                    date,
                    productId: product.id,
                    quantity,
                    documentNumber: doc,
                    source: 'EXCEL'
                }
            });
            processed++;

            // Emit progress every 50 processed rows
            if (io && (processed % 50 === 0 || i === data.length - 1)) {
                const pct = Math.round((i / totalRows) * 100);
                io.emit('production:upload:progress', { status: 'PROCESSING', current: i, total: totalRows, processed, skipped, percentage: pct });
            }
        }

        // Emit completion
        if (io) io.emit('production:upload:progress', { status: 'COMPLETED', current: totalRows, total: totalRows, processed, skipped, percentage: 100 });

        // Trigger velocity update
        logger.info('🔄 Triggering velocity update after production upload...');
        await dataMiningService.calculateVelocities().catch(err => logger.error('Async velocity update failed:', err));

        res.json({ success: true, processed, skipped });
    } catch (error) {
        const io = req.app.get('io');
        if (io) io.emit('production:upload:progress', { status: 'ERROR', message: error.message });
        logger.error('Error uploading production movements:', error.message);
        res.status(500).json({ error: 'Error procesando archivo de movimientos' });
    }
};

exports.getSummary = async (req, res) => {
    try {
        const totalSales = await prisma.movement.aggregate({
            where: { type: 'VTA' },
            _sum: { quantity: true },
            _count: true
        });

        const totalProd = await prisma.movement.aggregate({
            where: { type: 'PROD' },
            _sum: { quantity: true },
            _count: true
        });

        const lastMovements = await prisma.movement.findMany({
            take: 10,
            orderBy: { date: 'desc' },
            include: { product: { select: { name: true, sku: true } } }
        });

        res.json({
            sales: totalSales,
            production: totalProd,
            recent: lastMovements
        });
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo resumen' });
    }
};
