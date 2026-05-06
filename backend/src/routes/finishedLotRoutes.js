/**
 * finishedLotRoutes.js — /api/finished-lots
 *
 * REST endpoints for finished product lot stock management.
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const finishedLotService = require('../services/finishedLotService');
const { buildQrString } = require('../utils/qrFormat');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── GET /search-products?q=X — Search ONLY finished products (no raw material) ──
// accountGroup 1401 = LIQUIPOPS (AQUIPOPS), 1402 = GENIALITY / LIQUIMON
const FINISHED_PRODUCT_GROUPS = [1401, 1402];

router.get('/search-products', auth, async (req, res) => {
    try {
        const { q } = req.query;
        const where = { accountGroup: { in: FINISHED_PRODUCT_GROUPS }, active: true };
        if (q && q.length >= 2) {
            where.OR = [
                { name: { contains: q, mode: 'insensitive' } },
                { sku: { contains: q, mode: 'insensitive' } },
                { barcode: { contains: q, mode: 'insensitive' } },
            ];
        }
        const products = await prisma.product.findMany({
            where,
            select: { id: true, name: true, sku: true, barcode: true, currentStock: true, unit: true, packSize: true },
            orderBy: { name: 'asc' },
            take: 40,
        });
        res.json(products);
    } catch (err) {
        console.error('finished-lots/search-products error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /production-lots/:productId — Existing batch numbers for a product ──
// Searches by productId AND by flavor (since many batches have null productId)
router.get('/production-lots/:productId', auth, async (req, res) => {
    try {
        const { productId } = req.params;
        // Get product to extract flavor from name
        const product = await prisma.product.findUnique({ where: { id: productId }, select: { name: true } });
        // Extract flavor: "LIQUIPOPS SABOR A CHAMOY X 3400 GR" → "CHAMOY"
        let flavor = null;
        if (product?.name) {
            const m = product.name.match(/SABOR\s+A\s+(.+?)\s+X\s/i);
            if (m) flavor = m[1].trim().toUpperCase();
        }

        // Build OR condition: match by productId OR by flavor, only COMPLETED
        const batchWhere = { status: 'COMPLETED', OR: [{ productId }] };
        if (flavor) batchWhere.OR.push({ flavor: { equals: flavor, mode: 'insensitive' } });

        const batches = await prisma.productionBatch.findMany({
            where: batchWhere,
            select: { batchNumber: true, status: true, createdAt: true, expiresAt: true },
            orderBy: { createdAt: 'desc' },
            take: 30,
        });
        // Also get from FinishedLotStock (only lots with remaining stock)
        const existingLots = await prisma.finishedLotStock.findMany({
            where: { productId, currentQuantity: { gt: 0 } },
            select: { lotNumber: true, expiresAt: true, createdAt: true },
            distinct: ['lotNumber'],
            orderBy: { createdAt: 'desc' },
            take: 20,
        });
        // Get lot numbers that still have stock (to filter production batches)
        const activeStockLots = new Set(existingLots.map(l => l.lotNumber));
        // Also add warehouse lot numbers to active set
        const warehouseLots = await prisma.materialLot.findMany({
            where: { productId, zone: 'WAREHOUSE', currentQuantity: { gt: 0 } },
            select: { lotNumber: true, expiresAt: true, receivedAt: true },
            distinct: ['lotNumber'],
        });
        for (const w of warehouseLots) activeStockLots.add(w.lotNumber);

        // Merge and deduplicate — only include production lots that have active stock
        const lotSet = new Set();
        const lots = [];
        for (const b of batches) {
            if (!lotSet.has(b.batchNumber) && activeStockLots.has(b.batchNumber)) {
                lotSet.add(b.batchNumber);
                lots.push({ lotNumber: b.batchNumber, source: 'production', status: b.status, date: b.createdAt, expiresAt: b.expiresAt });
            }
        }
        for (const e of existingLots) {
            if (!lotSet.has(e.lotNumber)) {
                lotSet.add(e.lotNumber);
                lots.push({ lotNumber: e.lotNumber, source: 'registered', expiresAt: e.expiresAt, date: e.createdAt });
            }
        }
        // Add warehouse lots that weren't already included
        for (const w of warehouseLots) {
            if (!lotSet.has(w.lotNumber)) {
                lotSet.add(w.lotNumber);
                lots.push({ lotNumber: w.lotNumber, source: 'warehouse', expiresAt: w.expiresAt, date: w.receivedAt });
            }
        }
        res.json(lots);
    } catch (err) {
        console.error('finished-lots/production-lots error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /qr-payload/:productId — Standardized QR payload for any label ──
// Single source of truth for QR data across all frontend components
// QR STRING FORMAT: LOT:{lot}|SKU:{sku}|BAR:{barcode}|QTY:{qty}|BOX:{box}/{total}
router.get('/qr-payload/:productId', auth, async (req, res) => {
    try {
        const { productId } = req.params;
        const { lotNumber, quantity, receivedAt, expiresAt, boxNumber, totalBoxes } = req.query;
        const product = await prisma.product.findUnique({
            where: { id: productId },
            select: { name: true, sku: true, barcode: true, packSize: true },
        });
        if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

        const qty = parseInt(quantity) || 0;
        const barcode = product.barcode || product.sku || '';
        const box = parseInt(boxNumber) || 1;
        const total = parseInt(totalBoxes) || 1;

        // Canonical pipe-delimited QR string — from shared qrFormat.js
        const qrString = buildQrString({ lotNumber: lotNumber || '', sku: product.sku || '', barcode, quantity: qty, receivedAt, expiresAt, boxNumber: box, totalBoxes: total });

        res.json({ qrString, product: { ...product, barcode } });
    } catch (err) {
        console.error('qr-payload error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /lot-summary/:lotNumber — Stock summary by zone for a lot ──
// Only shows finished products (1401/1402), includes empaque approved/defective counts
router.get('/lot-summary/:lotNumber', auth, async (req, res) => {
    try {
        const { lotNumber } = req.params;
        const stocks = await prisma.finishedLotStock.findMany({
            where: {
                lotNumber,
                zone: 'PRODUCCION',
                product: { accountGroup: { in: [1401, 1402] } },
            },
            select: { zone: true, currentQuantity: true, initialQuantity: true, productId: true, product: { select: { name: true, sku: true } } },
        });
        // Also get warehouse stock from MaterialLot (old products with manual lots)
        const warehouseLots = await prisma.materialLot.findMany({
            where: {
                lotNumber,
                zone: 'WAREHOUSE',
                currentQuantity: { gt: 0 },
                product: { accountGroup: { in: [1401, 1402] } },
            },
            select: { currentQuantity: true, initialQuantity: true, productId: true, product: { select: { name: true, sku: true } } },
        });
        // Aggregate by zone+product
        const summary = {};
        for (const s of stocks) {
            const key = `${s.zone}|${s.product?.name || 'N/A'}`;
            if (!summary[key]) summary[key] = { zone: s.zone, productName: s.product?.name, sku: s.product?.sku, productId: s.productId, quantity: 0 };
            summary[key].quantity += s.currentQuantity;
        }
        // Include warehouse stock as PRODUCCION-equivalent for validation
        for (const w of warehouseLots) {
            const key = `PRODUCCION|${w.product?.name || 'N/A'}`;
            if (!summary[key]) summary[key] = { zone: 'PRODUCCION', productName: w.product?.name, sku: w.product?.sku, productId: w.productId, quantity: 0 };
            summary[key].quantity += w.currentQuantity;
        }

        // ── Enrich with empaque approved/defective data ──
        // Find the batch for this lot, then its EMPAQUE notes
        const batch = await prisma.productionBatch.findFirst({
            where: { batchNumber: lotNumber },
            select: { id: true },
        });
        const empaqueMap = {}; // productId → { approved, defective }
        if (batch) {
            const empaqueNotes = await prisma.assemblyNote.findMany({
                where: {
                    productionBatchId: batch.id,
                    processType: { code: 'EMPAQUE' },
                    status: 'COMPLETED',
                },
                select: { productId: true, processParameters: true, actualQuantity: true, targetQuantity: true },
            });
            for (const note of empaqueNotes) {
                const empData = note.processParameters?.empaque;
                if (note.productId) {
                    empaqueMap[note.productId] = {
                        approved: empData?.approved_qty ?? note.actualQuantity ?? null,
                        defective: empData?.defective_qty ?? 0,
                        defect_reasons: empData?.defect_reasons || [],
                        conteo_qty: empData?.conteo_qty ?? null,
                    };
                }
            }
        }

        // Merge empaque data into summary
        const result = Object.values(summary).map(s => ({
            ...s,
            approved: empaqueMap[s.productId]?.approved ?? null,
            defective: empaqueMap[s.productId]?.defective ?? 0,
        }));

        res.json(result);
    } catch (err) {
        console.error('lot-summary error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /ingest — Register stock from production ───────────────────────────
router.post('/ingest', auth, async (req, res) => {
    try {
        const { productId, lotNumber, quantity, batchId, expiresAt, zone, perCarrito, reason } = req.body;
        if (!productId || !lotNumber || !quantity) {
            return res.status(400).json({ error: 'productId, lotNumber y quantity son requeridos' });
        }
        const targetZone = zone || 'PRODUCCION';
        const qty = parseInt(quantity);

        // If target is PT or NC, we TRANSFER from PRODUCCION (decrement source)
        // Only PRODUCCION uses ingestFromProduction (creates new stock from assembly)
        if (targetZone !== 'PRODUCCION') {
            const result = await finishedLotService.transferZone({
                productId,
                lotNumber,
                fromZone: 'PRODUCCION',
                toZone: targetZone,
                quantity: qty,
                userId: req.user.id,
                reason: `Ingreso a ${targetZone} desde formulario de registro`,
            });
            return res.json({ success: true, stock: result.dest });
        }

        // Guard: PRODUCTO_EN_PROCESO intermediates are tracked via MaterialLot — skip FinishedLotStock
        const productInfo = await prisma.product.findUnique({
            where: { id: productId },
            select: { classification: true, name: true }
        });
        if (productInfo?.classification === 'PRODUCTO_EN_PROCESO') {
            console.log(`[ingest] Skipping FinishedLotStock for intermediate: ${productInfo.name} (PRODUCTO_EN_PROCESO → tracked via MaterialLot)`);
            return res.json({ success: true, skipped: true, reason: 'Intermedio rastreado via MaterialLot' });
        }

        // Default: ingest into PRODUCCION zone (new stock from assembly)
        const stock = await finishedLotService.ingestFromProduction({
            productId,
            lotNumber,
            quantity: qty,
            batchId: batchId || null,
            expiresAt: expiresAt || null,
            userId: req.user.id,
            zone: 'PRODUCCION',
            perCarrito: !!perCarrito,
            reason: reason || null,
        });
        res.json({ success: true, stock });
    } catch (err) {
        console.error('finished-lots/ingest error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /transfer — Move between zones ─────────────────────────────────────
router.post('/transfer', auth, async (req, res) => {
    try {
        // Only ADMIN and LOGISTICA can transfer between zones
        if (!['ADMIN', 'LOGISTICA'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Solo Logística puede realizar transferencias entre zonas' });
        }
        const { productId, lotNumber, fromZone, toZone, quantity, reason, observations } = req.body;
        if (!productId || !lotNumber || !fromZone || !toZone || !quantity) {
            return res.status(400).json({ error: 'productId, lotNumber, fromZone, toZone y quantity son requeridos' });
        }
        // Block BODEGA as destination for finished products
        if (toZone === 'BODEGA') {
            return res.status(400).json({ error: 'No se puede transferir producto terminado a Bodega. Solo materia prima va allí.' });
        }
        // ⛔ LOGISTICA NO puede transferir DESDE zona PRODUCCION.
        // El producto sólo sale de PRODUCCION vía Acta de Entrega (ProductHandoff)
        // creada por EMPAQUE y recibida por LOGISTICA. Si LOGISTICA pudiera mover
        // directamente desde PRODUCCION saltaría el handoff y `productionZoneStock`
        // quedaría descuadrado. Sólo ADMIN puede hacer este movimiento (escape hatch
        // para correcciones manuales).
        if (fromZone === 'PRODUCCION' && req.user.role !== 'ADMIN') {
            return res.status(403).json({
                error: 'No puedes transferir desde la zona de Producción. El producto debe entregarse mediante Acta de Entrega creada por Empaque.'
            });
        }
        const result = await finishedLotService.transferZone({
            productId,
            lotNumber,
            fromZone,
            toZone,
            quantity: parseInt(quantity),
            userId: req.user.id,
            reason: reason || null,
            observations: observations || null,
        });
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('finished-lots/transfer error:', err);
        const status = err.message.includes('insuficiente') ? 409 : 500;
        res.status(status).json({ error: err.message });
    }
});

// ── POST /consume — Consume for order picking ───────────────────────────────
router.post('/consume', auth, async (req, res) => {
    try {
        const { productId, lotNumber, quantity, orderId } = req.body;
        if (!productId || !lotNumber || !quantity) {
            return res.status(400).json({ error: 'productId, lotNumber y quantity son requeridos' });
        }
        const stock = await finishedLotService.consumeForOrder({
            productId,
            lotNumber,
            quantity: parseInt(quantity),
            orderId: orderId || null,
            userId: req.user.id,
        });
        res.json({ success: true, stock });
    } catch (err) {
        console.error('finished-lots/consume error:', err);
        const status = err.message.includes('insuficiente') ? 409 : 500;
        res.status(status).json({ error: err.message });
    }
});

// ── GET /stock?zone=X&productId=Y — Query stock by zone ────────────────────
router.get('/stock', auth, async (req, res) => {
    try {
        const { zone, productId } = req.query;
        if (!zone) return res.status(400).json({ error: 'zone es requerido' });
        const stocks = await finishedLotService.getStockByZone(zone, productId || null);
        res.json({ success: true, stocks });
    } catch (err) {
        console.error('finished-lots/stock error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /summary — Stock summary per zone (dashboard) ───────────────────────
router.get('/summary', auth, async (req, res) => {
    try {
        const summary = await finishedLotService.getStockSummary();
        res.json({ success: true, summary });
    } catch (err) {
        console.error('finished-lots/summary error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /available-lots/:productId — Lots for picking ───────────────────────
router.get('/available-lots/:productId', auth, async (req, res) => {
    try {
        const lots = await finishedLotService.getAvailableLots(req.params.productId);
        res.json({ success: true, lots });
    } catch (err) {
        console.error('finished-lots/available-lots error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /all-active — Todos los FinishedLotStock activos (para inventario físico) ──
router.get('/all-active', auth, async (req, res) => {
    try {
        const lots = await prisma.finishedLotStock.findMany({
            where: { currentQuantity: { gt: 0 }, status: { in: ['AVAILABLE', 'LOW'] }, zone: { not: 'PUBLICIDAD' } },
            include: {
                product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true, accountGroup: true, group: { select: { name: true } } } }
            },
            orderBy: [{ product: { name: 'asc' } }, { lotNumber: 'asc' }]
        });
        // Map to same shape as MaterialLot for frontend compatibility
        const mapped = lots.map(l => ({
            id: l.id,
            lotNumber: l.lotNumber,
            zone: l.zone,
            currentQuantity: l.currentQuantity,
            initialQuantity: l.initialQuantity,
            status: l.status,
            unit: l.product?.unit || 'unidad',
            receivedAt: l.createdAt,
            productId: l.productId,
            siigoProductName: l.product?.name || '',
            siigoProductCode: l.product?.sku || '',
            product: l.product,
            _source: 'FINISHED_LOT'
        }));
        res.json(mapped);
    } catch (err) {
        console.error('finished-lots/all-active error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /product-lots — All finished lots for a product (all zones) ─────────
router.get('/product-lots', auth, async (req, res) => {
    try {
        const { productId } = req.query;
        if (!productId) return res.status(400).json({ error: 'productId required' });
        const lots = await prisma.finishedLotStock.findMany({
            where: { productId },
            orderBy: [{ zone: 'asc' }, { lotNumber: 'asc' }],
            include: {
                _count: { select: { transfers: true } },
                product: { select: { id: true, name: true, sku: true, unit: true, barcode: true, packSize: true } },
            },
        });
        // Map to a format compatible with MaterialLot for the frontend
        const mapped = lots.map(l => ({
            id: l.id,
            productId: l.productId,
            product: l.product,
            lotNumber: l.lotNumber,
            zone: l.zone,
            currentQuantity: l.currentQuantity,
            initialQuantity: l.initialQuantity,
            status: l.status,
            receivedAt: l.createdAt,
            expiresAt: l.expiresAt,
            labelPrinted: l.labelPrinted || false,
            labelPrintedAt: l.labelPrintedAt || null,
            _type: 'FinishedLotStock',
            _source: 'FINISHED_LOT',
            _count: { consumptions: l._count.transfers, transfers: l._count.transfers },
        }));
        res.json(mapped);
    } catch (err) {
        console.error('finished-lots/product-lots error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /zone-summary — Stock per zone for a product ────────────────────────
router.get('/zone-summary', auth, async (req, res) => {
    try {
        const { productId } = req.query;
        if (!productId) return res.status(400).json({ error: 'productId required' });
        const stocks = await prisma.finishedLotStock.findMany({
            where: { productId, currentQuantity: { gt: 0 } },
            select: { zone: true, currentQuantity: true },
        });
        const summary = {};
        stocks.forEach(s => { summary[s.zone] = (summary[s.zone] || 0) + s.currentQuantity; });
        res.json({ success: true, summary });
    } catch (err) {
        console.error('finished-lots/zone-summary error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /movements — Transfer history ───────────────────────────────────────
router.get('/movements', auth, async (req, res) => {
    try {
        const { lotNumber, productId, limit } = req.query;
        const transfers = await finishedLotService.getTransferHistory({
            lotNumber: lotNumber || null,
            productId: productId || null,
            limit: limit ? parseInt(limit) : 50,
        });
        res.json({ success: true, transfers });
    } catch (err) {
        console.error('finished-lots/movements error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /by-order/:orderId — Lots for recall ────────────────────────────────
router.get('/by-order/:orderId', auth, async (req, res) => {
    try {
        const lots = await finishedLotService.getLotsByOrder(req.params.orderId);
        res.json({ success: true, lots });
    } catch (err) {
        console.error('finished-lots/by-order error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /by-lot/:lotNumber — Reverse: orders that received this lot ─────────
router.get('/by-lot/:lotNumber', auth, async (req, res) => {
    try {
        const data = await finishedLotService.getOrdersByLot(req.params.lotNumber);
        res.json({ success: true, data });
    } catch (err) {
        console.error('finished-lots/by-lot error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /recall-report — Aggregated recall report ───────────────────────────
router.get('/recall-report', auth, async (req, res) => {
    try {
        const { productId, lotNumber } = req.query;
        const report = await finishedLotService.getRecallReport({
            productId: productId || null,
            lotNumber: lotNumber || null,
        });
        res.json({ success: true, report });
    } catch (err) {
        console.error('finished-lots/recall-report error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── GET /warehouse-stock — Finished products in main warehouse (MaterialLot + FinishedLotStock BODEGA) ─
router.get('/warehouse-stock', auth, async (req, res) => {
    try {
        // 1. MaterialLot WAREHOUSE (legacy Siigo-synced lots)
        const matLots = await prisma.materialLot.findMany({
            where: {
                zone: 'WAREHOUSE',
                currentQuantity: { gt: 0 },
                product: { accountGroup: { in: FINISHED_PRODUCT_GROUPS } },
            },
            include: {
                product: { select: { id: true, name: true, sku: true, unit: true, barcode: true, packSize: true } },
            },
            orderBy: { siigoProductName: 'asc' },
        });
        const matStocks = matLots.map(l => ({
            id: l.id,
            productId: l.productId,
            product: l.product,
            lotNumber: l.lotNumber,
            currentQuantity: l.currentQuantity,
            initialQuantity: l.initialQuantity,
            zone: 'BODEGA',
            status: l.currentQuantity > 20 ? 'AVAILABLE' : l.currentQuantity > 5 ? 'LOW' : 'DEPLETED',
            expiresAt: l.expiresAt,
            labelPrinted: l.labelPrinted || false,
            labelPrintedAt: l.labelPrintedAt || null,
            source: 'materialLot',
        }));

        // 2. FinishedLotStock BODEGA (transferred via zone transfer)
        const flsLots = await prisma.finishedLotStock.findMany({
            where: {
                zone: 'BODEGA',
                currentQuantity: { gt: 0 },
            },
            include: {
                product: { select: { id: true, name: true, sku: true, unit: true, barcode: true, packSize: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        const flsStocks = flsLots.map(f => ({
            id: f.id,
            productId: f.productId,
            product: f.product,
            lotNumber: f.lotNumber,
            currentQuantity: f.currentQuantity,
            initialQuantity: f.initialQuantity,
            zone: 'BODEGA',
            status: f.currentQuantity > 20 ? 'AVAILABLE' : f.currentQuantity > 5 ? 'LOW' : 'DEPLETED',
            expiresAt: f.expiresAt,
            labelPrinted: f.labelPrinted || false,
            labelPrintedAt: f.labelPrintedAt || null,
            source: 'finishedLotStock',
        }));

        res.json({ success: true, stocks: [...matStocks, ...flsStocks] });
    } catch (err) {
        console.error('finished-lots/warehouse-stock error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /warehouse-transfer — Transfer from Bodega (MaterialLot) to PT ─────
router.post('/warehouse-transfer', auth, async (req, res) => {
    try {
        if (!['ADMIN', 'LOGISTICA'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Solo Logística puede realizar transferencias entre zonas' });
        }
        const { materialLotId, productId, lotNumber, quantity } = req.body;
        if (!materialLotId || !productId || !lotNumber || !quantity) {
            return res.status(400).json({ error: 'materialLotId, productId, lotNumber y quantity son requeridos' });
        }
        const qty = parseInt(quantity);
        if (qty <= 0) return res.status(400).json({ error: 'Cantidad debe ser mayor a 0' });

        const result = await prisma.$transaction(async (tx) => {
            // 1. Decrement MaterialLot in WAREHOUSE
            const lot = await tx.materialLot.findUnique({ where: { id: materialLotId } });
            if (!lot) throw new Error('Lote no encontrado en bodega');
            if (lot.currentQuantity < qty) throw new Error(`Stock insuficiente en bodega: ${lot.currentQuantity} disponibles, solicitados ${qty}`);

            await tx.materialLot.update({
                where: { id: materialLotId },
                data: { currentQuantity: { decrement: qty } },
            });

            // 2. Create or increment FinishedLotStock in PRODUCTO_TERMINADO
            const existing = await tx.finishedLotStock.findFirst({
                where: { productId, lotNumber, zone: 'PRODUCTO_TERMINADO' },
            });
            let dest;
            if (existing) {
                dest = await tx.finishedLotStock.update({
                    where: { id: existing.id },
                    data: { currentQuantity: { increment: qty } },
                });
            } else {
                dest = await tx.finishedLotStock.create({
                    data: {
                        productId,
                        lotNumber,
                        initialQuantity: qty,
                        currentQuantity: qty,
                        zone: 'PRODUCTO_TERMINADO',
                        expiresAt: lot.expiresAt || null,
                    },
                });
            }

            // 3. Log transfer for traceability
            await tx.finishedLotTransfer.create({
                data: {
                    finishedLotStockId: dest.id,
                    productId,
                    lotNumber,
                    fromZone: 'BODEGA',
                    toZone: 'PRODUCTO_TERMINADO',
                    quantity: qty,
                    reason: 'Traslado desde bodega principal',
                    transferredById: req.user.id,
                },
            });

            return dest;
        });

        res.json({ success: true, stock: result });
    } catch (err) {
        console.error('finished-lots/warehouse-transfer error:', err);
        const status = err.message.includes('insuficiente') ? 409 : 500;
        res.status(status).json({ error: err.message });
    }
});
// ============================================
// PENDING BOX — Multi-Lot Label System
// ============================================

// GET /pending-box/:productId — find pending box for product + boxSize
router.get('/pending-box/:productId', auth, async (req, res) => {
    try {
        const { productId } = req.params;
        const boxSize = parseInt(req.query.boxSize) || 0;
        if (!boxSize) return res.json(null);

        const box = await prisma.pendingBox.findFirst({
            where: { productId, boxSize },
            include: {
                product: { select: { name: true, sku: true } },
                entries: { orderBy: { createdAt: 'asc' } },
            },
        });

        if (!box) return res.json(null);

        // Normaliza la respuesta al mismo shape esperado por el frontend
        res.json({
            ...box,
            entries: box.entries.map(e => ({ lot: e.lot, qty: e.qty, expiry: e.expiry ? e.expiry.toISOString().slice(0, 10) : null })),
        });
    } catch (err) {
        console.error('GET pending-box error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /pending-box — save or update a pending box
router.post('/pending-box', auth, async (req, res) => {
    try {
        const { productId, boxSize, isMaquila, entries } = req.body;
        // entries: [{lot, qty, expiry}]
        const currentQty = entries.reduce((sum, e) => sum + (e.qty || 0), 0);

        const box = await prisma.$transaction(async (tx) => {
            // Buscar o crear el box
            let existing = await tx.pendingBox.findFirst({ where: { productId, boxSize } });

            let boxRecord;
            if (existing) {
                boxRecord = await tx.pendingBox.update({
                    where: { id: existing.id },
                    data: { currentQty, isMaquila: isMaquila ?? existing.isMaquila },
                });
                // Reemplazar entries: borrar las viejas y crear las nuevas
                await tx.pendingBoxEntry.deleteMany({ where: { boxId: existing.id } });
            } else {
                boxRecord = await tx.pendingBox.create({
                    data: { productId, boxSize, isMaquila: isMaquila ?? false, currentQty },
                });
            }

            // Crear entries normalizadas
            await tx.pendingBoxEntry.createMany({
                data: entries.map(e => ({
                    boxId: boxRecord.id,
                    lot: e.lot,
                    qty: e.qty || 0,
                    expiry: e.expiry ? new Date(e.expiry) : null,
                })),
            });

            return boxRecord;
        });

        // Retornar con entries para que el frontend actualice estado
        const populated = await prisma.pendingBox.findUnique({
            where: { id: box.id },
            include: { entries: { orderBy: { createdAt: 'asc' } } },
        });

        res.json({
            ...populated,
            entries: populated.entries.map(e => ({ lot: e.lot, qty: e.qty, expiry: e.expiry ? e.expiry.toISOString().slice(0, 10) : null })),
        });
    } catch (err) {
        console.error('POST pending-box error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /pending-box/:id — remove (box completed or cancelled)
router.delete('/pending-box/:id', auth, async (req, res) => {
    try {
        await prisma.pendingBox.delete({ where: { id: req.params.id } });
        res.json({ ok: true });
    } catch (err) {
        console.error('DELETE pending-box error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── POST /mark-printed — Mark a lot label as printed ──
router.post('/mark-printed', auth, async (req, res) => {
    try {
        const { lotId, type } = req.body; // type: 'finished' | 'material'
        if (!lotId) return res.status(400).json({ error: 'lotId required' });

        const now = new Date();
        if (type === 'material') {
            await prisma.materialLot.update({
                where: { id: lotId },
                data: { labelPrinted: true, labelPrintedAt: now },
            });
        } else {
            await prisma.finishedLotStock.update({
                where: { id: lotId },
                data: { labelPrinted: true, labelPrintedAt: now },
            });
        }
        res.json({ ok: true, labelPrintedAt: now });
    } catch (err) {
        console.error('mark-printed error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
