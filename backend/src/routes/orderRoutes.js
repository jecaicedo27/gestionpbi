const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const distributorController = require('../controllers/distributorController');
const { auth, roles } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Legacy routes (kept for compatibility)
router.get('/catalog', auth, distributorController.getCatalog);
router.post('/', auth, roles(['DISTRIBUIDOR', 'ADMIN', 'LOGISTICA']), orderController.createOrder);

// Excel template download — any authenticated user can download
router.get('/template', auth, orderController.getOrderTemplate);

// Excel upload — uses memory storage (xlsx reads from buffer)
const excelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.post('/upload-excel', auth, roles(['ADMIN', 'LOGISTICA', 'COMERCIAL', 'DISTRIBUIDOR']),
    excelUpload.single('file'), orderController.createOrderFromExcel);

// Admin/Logistics Routes
router.get('/counts', auth, roles(['ADMIN', 'LOGISTICA', 'DISTRIBUIDOR', 'COMERCIAL']), orderController.getOrderCounts);
router.get('/pending-summary', auth, roles(['ADMIN', 'LOGISTICA', 'DISTRIBUIDOR', 'COMERCIAL']), orderController.getPendingDeliverySummary);
router.get('/', auth, roles(['ADMIN', 'LOGISTICA', 'DISTRIBUIDOR', 'COMERCIAL']), orderController.getAllOrders);
router.get('/:id', auth, orderController.getOrderById);
router.patch('/:id/status', auth, roles(['ADMIN', 'LOGISTICA']), orderController.updateOrderStatus);
router.patch('/:id', auth, roles(['ADMIN', 'LOGISTICA', 'COMERCIAL', 'DISTRIBUIDOR']), orderController.patchOrder);

// Workflow endpoints
router.post('/:id/approve', auth, roles(['ADMIN', 'COMERCIAL']), orderController.approveOrder);
router.post('/:id/reject', auth, roles(['ADMIN', 'LOGISTICA']), orderController.rejectOrder);
router.delete('/:id', auth, roles(['ADMIN']), orderController.deleteOrder);
router.post('/:id/mark-ready', auth, roles(['LOGISTICA']), orderController.markReady);

// Invoicing — creates invoice directly in Siigo
router.post('/:id/invoice', auth, roles(['ADMIN', 'COMERCIAL']), orderController.invoiceOrder);

// Dispatch (logistics fills driver form)
router.post('/:id/dispatch', auth, roles(['ADMIN', 'LOGISTICA']), orderController.dispatchOrder);

// Delivery confirmation — distributor or logistics can confirm, with optional signed guide upload
const SIGNED_DIR = path.join(__dirname, '../../uploads/signed-guides');
if (!fs.existsSync(SIGNED_DIR)) fs.mkdirSync(SIGNED_DIR, { recursive: true });
const signedGuideUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, SIGNED_DIR),
        filename: (req, file, cb) => cb(null, `guia-firmada-${req.params.id}-${Date.now()}${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 10 * 1024 * 1024 }
});
router.post('/:id/deliver', auth, roles(['ADMIN', 'LOGISTICA', 'DISTRIBUIDOR']),
    signedGuideUpload.single('signedGuide'), orderController.deliverOrder);

// Transport guide (printable HTML — no auth since it opens in a new browser tab)
router.get('/:id/transport-guide', orderController.getTransportGuide);

// Picking sheet (printable HTML — no auth since it opens in a new browser tab for printing)
router.get('/:id/picking-sheet', orderController.getPickingSheet);

// Upload generic photos for ready evidence (minimum 3 before invoicing)
const READY_PHOTOS_DIR = path.join(__dirname, '../../uploads/orders/ready');
if (!fs.existsSync(READY_PHOTOS_DIR)) fs.mkdirSync(READY_PHOTOS_DIR, { recursive: true });
const readyUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, READY_PHOTOS_DIR),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname) || '.jpg';
            cb(null, `${req.params.id}-${Date.now()}${ext}`);
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 }
});
router.post('/:id/ready-photos', auth, roles(['ADMIN', 'LOGISTICA', 'COMERCIAL']), readyUpload.single('photo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const url = `/uploads/orders/ready/${req.file.filename}`;
        
        const currentOrder = await prisma.order.findUnique({ where: { id: req.params.id }, select: { readyPhotosUrls: true } });
        if (!currentOrder) return res.status(404).json({ error: 'Order not found' });
        
        const updatedUrls = [...(currentOrder.readyPhotosUrls || []), url];
        const updated = await prisma.order.update({
            where: { id: req.params.id },
            data: { readyPhotosUrls: updatedUrls }
        });
        res.json({ ok: true, url, readyPhotosUrls: updated.readyPhotosUrls });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Siigo invoice PDF proxy — streams PDF from Siigo API
router.get('/:id/siigo-pdf', auth, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            select: { invoicePdfUrl: true, invoiceNumber: true }
        });

        if (!order?.invoicePdfUrl) {
            return res.status(404).json({ error: 'No hay factura Siigo para este pedido' });
        }

        const siigoService = require('../services/siigoService');
        const pdfBuffer = await siigoService.getInvoicePdf(order.invoicePdfUrl);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${order.invoiceNumber || 'factura'}.pdf"`);
        res.send(Buffer.from(pdfBuffer));
    } catch (err) {
        console.error('Siigo PDF proxy error:', err.message);
        res.status(500).json({ error: 'Error obteniendo PDF de Siigo' });
    }
});

module.exports = router;
