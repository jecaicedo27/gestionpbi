/**
 * procurementRoutes.js — All procurement system routes
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const upload = multer({ storage: multer.memoryStorage() });
const { auth, roles } = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const purchaseOrderController = require('../controllers/purchaseOrderController');
const receptionController = require('../controllers/receptionController');
const forecastService = require('../services/forecastService');
const { generatePDF } = require('../services/purchaseOrderPdf');
const { generateLotLabel } = require('../services/lotLabelPdf');

// ── File upload storage (shared for quotations + invoice photos) ──
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
const QUOTATION_DIR = path.join(UPLOAD_DIR, 'quotations');
const INVOICE_DIR = path.join(UPLOAD_DIR, 'invoice-photos');
const RECEPTION_PHOTO_DIR = path.join(UPLOAD_DIR, 'reception-photos');
[QUOTATION_DIR, INVOICE_DIR, RECEPTION_PHOTO_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const makeStorage = (dir, prefix) => multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
    }
});
const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Solo se permiten imágenes o PDF'));
};
const quotationUpload = multer({ storage: makeStorage(QUOTATION_DIR, 'cotizacion'), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter });
const invoiceUpload = multer({ storage: makeStorage(INVOICE_DIR, 'factura'), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter });
const receptionPhotoUpload = multer({ storage: makeStorage(RECEPTION_PHOTO_DIR, 'recepcion'), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter });

// ── Purchase Orders ──

router.get('/purchase-orders', auth, purchaseOrderController.list);
router.get('/purchase-orders/:id', auth, purchaseOrderController.getById);
router.get('/purchase-orders/:id/pdf', auth, generatePDF);
router.post('/purchase-orders', auth, roles('ADMIN', 'PRODUCCION'), purchaseOrderController.create);
router.put('/purchase-orders/:id/approve', auth, roles('ADMIN', 'PRODUCCION'), purchaseOrderController.approve);
router.put('/purchase-orders/:id/send', auth, roles('ADMIN', 'PRODUCCION'), purchaseOrderController.markSent);
router.put('/purchase-orders/:id/send-to-cartera', auth, roles('ADMIN', 'PRODUCCION'), purchaseOrderController.sendToCartera);
router.put('/purchase-orders/:id/payment', auth, roles('ADMIN', 'CARTERA', 'CONTABILIDAD'), purchaseOrderController.registerPayment);
router.put('/purchase-orders/:id/credit-payment', auth, roles('ADMIN', 'CARTERA', 'CONTABILIDAD'), purchaseOrderController.registerCreditPayment);
router.put('/purchase-orders/:id/cancel', auth, roles('ADMIN', 'PRODUCCION'), purchaseOrderController.cancel);

// ── Payment Proof Upload ──
const PAYMENT_DIR = path.join(UPLOAD_DIR, 'payment-proofs');
if (!fs.existsSync(PAYMENT_DIR)) fs.mkdirSync(PAYMENT_DIR, { recursive: true });
const paymentUpload = multer({ storage: makeStorage(PAYMENT_DIR, 'pago'), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter });

router.post('/purchase-orders/:id/payment-proof', auth, roles('ADMIN', 'CARTERA', 'CONTABILIDAD'), paymentUpload.array('files', 10), async (req, res) => {
    try {
        const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, select: { paymentProofUrls: true } });
        if (!order) return res.status(404).json({ error: 'OC no encontrada' });
        const existing = Array.isArray(order.paymentProofUrls) ? order.paymentProofUrls : [];
        const newUrls = (req.files || []).map(f => `/uploads/payment-proofs/${f.filename}`);
        const updated = await prisma.purchaseOrder.update({
            where: { id: req.params.id },
            data: { paymentProofUrls: [...existing, ...newUrls] }
        });
        res.json({ paymentProofUrls: updated.paymentProofUrls });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error subiendo comprobante' }); }
});

router.delete('/purchase-orders/:id/payment-proof', auth, async (req, res) => {
    try {
        const { url } = req.body;
        const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, select: { paymentProofUrls: true } });
        if (!order) return res.status(404).json({ error: 'OC no encontrada' });
        const existing = Array.isArray(order.paymentProofUrls) ? order.paymentProofUrls : [];
        const updated = await prisma.purchaseOrder.update({
            where: { id: req.params.id },
            data: { paymentProofUrls: existing.filter(u => u !== url) }
        });
        const filePath = path.join(UPLOAD_DIR, url.replace('/uploads/', ''));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.json({ paymentProofUrls: updated.paymentProofUrls });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error eliminando comprobante' }); }
});

// ── Quotation Upload ──
router.post('/purchase-orders/:id/quotation', auth, quotationUpload.array('files', 10), async (req, res) => {
    try {
        const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, select: { quotationUrls: true } });
        if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
        const existing = Array.isArray(order.quotationUrls) ? order.quotationUrls : [];
        const newUrls = (req.files || []).map(f => `/uploads/quotations/${f.filename}`);
        const updated = await prisma.purchaseOrder.update({
            where: { id: req.params.id },
            data: { quotationUrls: [...existing, ...newUrls] }
        });
        res.json({ quotationUrls: updated.quotationUrls });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error subiendo cotización' }); }
});

router.delete('/purchase-orders/:id/quotation', auth, async (req, res) => {
    try {
        const { url } = req.body;
        const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, select: { quotationUrls: true } });
        if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
        const existing = Array.isArray(order.quotationUrls) ? order.quotationUrls : [];
        const updated = await prisma.purchaseOrder.update({
            where: { id: req.params.id },
            data: { quotationUrls: existing.filter(u => u !== url) }
        });
        // Delete file from disk
        const filePath = path.join(__dirname, '../../uploads', url.replace('/uploads/', ''));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.json({ quotationUrls: updated.quotationUrls });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error eliminando archivo' }); }
});

// ── Siigo Data ──

router.get('/suppliers', auth, purchaseOrderController.getSuppliers);
router.get('/raw-materials', auth, purchaseOrderController.getRawMaterials);

// ── Sync Suppliers from Siigo ──
// ── In-memory sync status ──
let supplierSyncStatus = { running: false, result: null, startedAt: null };
const siigoQueue = require('../services/siigoQueue');

router.post('/suppliers/sync', auth, roles('ADMIN', 'PRODUCCION', 'CONTABILIDAD'), async (req, res) => {
    if (supplierSyncStatus.running) {
        const qStatus = siigoQueue.status();
        return res.json({ status: 'RUNNING', message: `Sincronización en progreso... ${qStatus.running ? '(esperando: ' + qStatus.running + ')' : ''}` });
    }

    supplierSyncStatus = { running: true, result: null, startedAt: new Date() };
    res.json({ status: 'STARTED', message: 'Sincronización encolada' });

    // Enqueue through siigoQueue so it waits for CRON to finish
    siigoQueue.enqueue('sync-proveedores', async () => {
        const siigoService = require('../services/siigoService');
        const logger = require('../utils/logger');

        logger.info('📡 Starting Siigo supplier sync...');
        const siigoSuppliers = await siigoService.getSuppliers();

        let synced = 0;
        for (const s of siigoSuppliers) {
            if (!s.id) continue;
            await prisma.supplier.upsert({
                where: { siigoId: String(s.id) },
                update: {
                    name: s.name || 'Sin nombre',
                    identification: s.identification || null,
                    email: s.email || null,
                    phone: s.phone || null,
                    type: 'Supplier',
                    active: true,
                },
                create: {
                    siigoId: String(s.id),
                    name: s.name || 'Sin nombre',
                    identification: s.identification || null,
                    email: s.email || null,
                    phone: s.phone || null,
                    type: 'Supplier',
                    active: true,
                }
            });
            synced++;
        }

        logger.info(`✅ Supplier sync complete: ${synced} proveedores sincronizados`);
        supplierSyncStatus = { running: false, result: { success: true, synced, total: siigoSuppliers.length }, startedAt: null };
    }).catch(error => {
        console.error('Supplier sync error:', error.message);
        supplierSyncStatus = { running: false, result: { success: false, error: error.message }, startedAt: null };
    });
});

router.get('/suppliers/sync-status', auth, async (req, res) => {
    res.json(supplierSyncStatus);
});

// ── Supplier Tax Config ──
router.get('/suppliers/:id/tax-config', auth, async (req, res) => {
    try {
        const supplier = await prisma.supplier.findUnique({
            where: { id: req.params.id },
            select: { id: true, name: true, identification: true, ivaRate: true, reteFuenteRate: true, paymentTermDays: true, fiscalConfigConfirmed: true, fiscalConfigAt: true }
        });
        if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado' });
        res.json(supplier);
    } catch (err) { res.status(500).json({ error: 'Error obteniendo config fiscal' }); }
});

router.put('/suppliers/:id/tax-config', auth, roles('ADMIN', 'CONTABILIDAD'), async (req, res) => {
    try {
        const { ivaRate, reteFuenteRate, paymentTermDays, securityCode } = req.body;

        // Security code required to confirm fiscal configuration
        if (!securityCode || securityCode !== '1987') {
            return res.status(403).json({ error: 'Código de seguridad incorrecto' });
        }

        const updated = await prisma.supplier.update({
            where: { id: req.params.id },
            data: {
                ivaRate: ivaRate !== undefined ? (parseFloat(ivaRate) || 0) : 0,
                reteFuenteRate: reteFuenteRate !== undefined ? (parseFloat(reteFuenteRate) || 0) : 0,
                paymentTermDays: paymentTermDays !== undefined ? (parseInt(paymentTermDays) || 30) : 30,
                fiscalConfigConfirmed: true,
                fiscalConfigAt: new Date(),
                fiscalConfigById: req.user?.id || null
            }
        });
        res.json(updated);
    } catch (err) { console.error('Tax config error:', err); res.status(500).json({ error: 'Error actualizando config fiscal' }); }
});

// ── Receptions ──

router.post('/receptions', auth, roles('ADMIN', 'DIRECTOR_TECNICO', 'LIDER_OPERACIONES', 'CALIDAD', 'LOGISTICA'), receptionController.create);
router.get('/receptions/:id', auth, receptionController.getById);
router.put('/receptions/:id/validate', auth, roles('ADMIN', 'CONTABILIDAD'), receptionController.validate);

// ── Invoice Photo Upload (during reception) ──
router.post('/receptions/:id/invoice-photo', auth, invoiceUpload.array('files', 10), async (req, res) => {
    try {
        const reception = await prisma.reception.findUnique({ where: { id: req.params.id }, select: { invoiceImageUrls: true } });
        if (!reception) return res.status(404).json({ error: 'Recepción no encontrada' });
        const existing = Array.isArray(reception.invoiceImageUrls) ? reception.invoiceImageUrls : [];
        const newUrls = (req.files || []).map(f => `/uploads/invoice-photos/${f.filename}`);
        const updated = await prisma.reception.update({
            where: { id: req.params.id },
            data: { invoiceImageUrls: [...existing, ...newUrls] }
        });
        res.json({ invoiceImageUrls: updated.invoiceImageUrls });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error subiendo foto de factura' }); }
});

router.delete('/receptions/:id/invoice-photo', auth, async (req, res) => {
    try {
        const { url } = req.body;
        const reception = await prisma.reception.findUnique({ where: { id: req.params.id }, select: { invoiceImageUrls: true } });
        if (!reception) return res.status(404).json({ error: 'Recepción no encontrada' });
        const existing = Array.isArray(reception.invoiceImageUrls) ? reception.invoiceImageUrls : [];
        const updated = await prisma.reception.update({
            where: { id: req.params.id },
            data: { invoiceImageUrls: existing.filter(u => u !== url) }
        });
        const filePath = path.join(UPLOAD_DIR, url.replace('/uploads/', ''));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.json({ invoiceImageUrls: updated.invoiceImageUrls });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error eliminando foto' }); }
});

// ── Siigo Screenshot Upload (accounting step) ──
const SIIGO_SCREENSHOT_DIR = path.join(UPLOAD_DIR, 'siigo-screenshots');
if (!fs.existsSync(SIIGO_SCREENSHOT_DIR)) fs.mkdirSync(SIIGO_SCREENSHOT_DIR, { recursive: true });
const siigoScreenshotUpload = multer({ storage: makeStorage(SIIGO_SCREENSHOT_DIR, 'siigo'), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter });

router.post('/receptions/:id/siigo-screenshot', auth, roles('ADMIN', 'CONTABILIDAD'), siigoScreenshotUpload.single('file'), async (req, res) => {
    try {
        const url = `/uploads/siigo-screenshots/${req.file.filename}`;
        const updated = await prisma.reception.update({
            where: { id: req.params.id },
            data: { siigoScreenshotUrl: url }
        });
        res.json({ siigoScreenshotUrl: updated.siigoScreenshotUrl });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error subiendo captura de Siigo' }); }
});

// ── Siigo Purchase Lookup (cross-validation) ──
router.get('/siigo-purchase/:number', auth, roles('ADMIN', 'CONTABILIDAD'), async (req, res) => {
    try {
        const siigoService = require('../services/siigoService');
        const purchaseNumber = req.params.number;

        if (!purchaseNumber || !purchaseNumber.trim()) {
            return res.status(400).json({ error: 'Debe ingresar un número de compra' });
        }

        const purchase = await siigoService.getPurchaseByNumber(purchaseNumber.trim());

        if (!purchase) {
            return res.status(404).json({ error: `No se encontró la compra #${purchaseNumber} en Siigo` });
        }

        res.json(purchase);
    } catch (err) {
        console.error('Error fetching Siigo purchase:', err.message);
        const msg = err.response?.status === 429
            ? 'Siigo está limitando las peticiones. Espera un momento.'
            : `Error consultando compra en Siigo: ${err.message}`;
        res.status(500).json({ error: msg });
    }
});

// ── Reception Photos Upload (product/reception photos during logistics) ──
router.post('/receptions/:id/reception-photos', auth, receptionPhotoUpload.array('files', 10), async (req, res) => {
    try {
        const reception = await prisma.reception.findUnique({ where: { id: req.params.id }, select: { receptionPhotoUrls: true } });
        if (!reception) return res.status(404).json({ error: 'Recepción no encontrada' });
        const existing = Array.isArray(reception.receptionPhotoUrls) ? reception.receptionPhotoUrls : [];
        const newUrls = (req.files || []).map(f => `/uploads/reception-photos/${f.filename}`);
        const updated = await prisma.reception.update({
            where: { id: req.params.id },
            data: { receptionPhotoUrls: [...existing, ...newUrls] }
        });
        res.json({ receptionPhotoUrls: updated.receptionPhotoUrls });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error subiendo fotos de recepción' }); }
});

// ── Material Lots ──

router.post('/lots', auth, roles('ADMIN', 'DIRECTOR_TECNICO', 'LIDER_OPERACIONES', 'CALIDAD', 'LOGISTICA'), receptionController.createLots);
router.get('/lots', auth, receptionController.listLots);
router.get('/lots/stock-summary', auth, receptionController.stockSummary);
router.get('/lots/:id/label', auth, generateLotLabel);

// ── Update Material Lot (edit expiresAt, lotNumber, etc.) ──
router.patch('/lots/:id', auth, roles('ADMIN', 'DIRECTOR_TECNICO', 'LIDER_OPERACIONES', 'CALIDAD', 'LOGISTICA'), async (req, res) => {
    try {
        const { expiresAt, lotNumber } = req.body;
        const updateData = {};
        if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
        if (lotNumber !== undefined) updateData.lotNumber = lotNumber;
        const lot = await prisma.materialLot.update({ where: { id: req.params.id }, data: updateData });
        res.json(lot);
    } catch (err) {
        console.error('Error updating lot:', err);
        res.status(500).json({ error: 'Error actualizando lote' });
    }
});

// ── Forecast ──

router.get('/forecast', auth, async (req, res) => {
    try {
        const result = await forecastService.calculateForecast();
        res.json(result);
    } catch (error) {
        console.error('Forecast error:', error.message);
        res.status(500).json({ error: 'Error calculando forecast' });
    }
});

router.get('/forecast/config', auth, async (req, res) => {
    try {
        const config = await forecastService.getConfig();
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo configuración' });
    }
});

router.put('/forecast/config', auth, roles('ADMIN', 'DIRECTOR_TECNICO'), async (req, res) => {
    try {
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        const { inventoryWeeks, bufferPct, growthBufferPct } = req.body;

        const updates = [];
        if (inventoryWeeks !== undefined) {
            updates.push(prisma.forecastConfig.upsert({
                where: { key: 'inventory_weeks' },
                update: { value: String(inventoryWeeks) },
                create: { key: 'inventory_weeks', value: String(inventoryWeeks), description: 'Semanas de inventario mínimo' }
            }));
        }
        if (bufferPct !== undefined) {
            updates.push(prisma.forecastConfig.upsert({
                where: { key: 'buffer_pct' },
                update: { value: String(bufferPct) },
                create: { key: 'buffer_pct', value: String(bufferPct), description: 'Porcentaje de buffer estándar' }
            }));
        }
        if (growthBufferPct !== undefined) {
            updates.push(prisma.forecastConfig.upsert({
                where: { key: 'growth_buffer_pct' },
                update: { value: String(growthBufferPct) },
                create: { key: 'growth_buffer_pct', value: String(growthBufferPct), description: 'Porcentaje de buffer para productos en crecimiento' }
            }));
        }

        await Promise.all(updates);
        const config = await forecastService.getConfig();
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: 'Error actualizando configuración' });
    }
});

// ── Packaging Conversions ──

router.get('/packaging', auth, async (req, res) => {
    try {
        const packagings = await prisma.productPackaging.findMany({ orderBy: { packagingDesc: 'asc' } });
        res.json(packagings);
    } catch (error) {
        console.error('Packaging error:', error.message);
        res.status(500).json({ error: 'Error obteniendo empaques' });
    }
});

router.post('/packaging', auth, roles('ADMIN', 'DIRECTOR_TECNICO'), async (req, res) => {
    try {
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        const { siigoProductCode, siigoProductName, packagingDesc, gramsPerUnit } = req.body;

        const pkg = await prisma.productPackaging.upsert({
            where: { siigoProductCode },
            update: { siigoProductName, packagingDesc, gramsPerUnit },
            create: { siigoProductCode, siigoProductName, packagingDesc, gramsPerUnit }
        });
        res.json(pkg);
    } catch (error) {
        res.status(500).json({ error: 'Error guardando empaque' });
    }
});

module.exports = router;
