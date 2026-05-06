const express = require('express');
const router = express.Router();
const assemblyNoteController = require('../controllers/genialityAssemblyNoteController');
const { auth } = require('../middleware/auth');
const productionBatchController = require('../controllers/productionBatchController');

// All routes are prefixed with /api/assembly-notes in index.js

router.get('/', assemblyNoteController.getAllNotes);
router.get('/:id', assemblyNoteController.getNoteById);
router.post('/quick-start', assemblyNoteController.quickStart);
router.post('/generate', assemblyNoteController.generateForBatch);

// Execution flow
router.get('/:id/validate', assemblyNoteController.validateMaterials);
router.post('/:id/start', assemblyNoteController.startNote);

// Merge-patch processParameters (for draft persistence — preserves other keys)
const { PrismaClient } = require('@prisma/client');
const _notePrisma = new PrismaClient();
router.patch('/:id/process-params', async (req, res) => {
    try {
        const { id } = req.params;
        const incoming = req.body.processParameters || {};
        const note = await _notePrisma.assemblyNote.findUnique({
            where: { id }, select: { processParameters: true }
        });
        if (!note) return res.status(404).json({ error: 'Note not found' });
        const merged = { ...(note.processParameters || {}), ...incoming };
        const updated = await _notePrisma.assemblyNote.update({
            where: { id }, data: { processParameters: merged }
        });
        res.json({ ok: true, processParameters: updated.processParameters });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/:id', assemblyNoteController.updateNote);
router.patch('/:id/items/:itemId', assemblyNoteController.updateItemActualQty);

router.post('/:id/variables', assemblyNoteController.recordVariable);
router.get('/:id/check-proteccion', assemblyNoteController.checkProteccion);
router.post('/:id/complete', auth, assemblyNoteController.completeNote);

// ── POST /:id/consume-carrito — Geniality: consume packaging materials per carrito ──
// Called when each carrito is processed in GEmpaqueStep (isPartialIngest).
// Proportionally deducts packaging items (botellas, tapas, etiquetas, etc.) from
// currentStock based on the carrito quantity. ONLY for Geniality G_EMPAQUE notes.
// This is idempotent per carritoId — duplicate calls are silently ignored.
router.post('/:id/consume-carrito', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { carritoId, carritoQty, operatorId } = req.body;
        if (!carritoId || !carritoQty || carritoQty <= 0) {
            return res.status(400).json({ error: 'carritoId y carritoQty son requeridos' });
        }

        const note = await _notePrisma.assemblyNote.findUnique({
            where: { id },
            include: {
                processType: true,
                product: true,
                items: { include: { component: true } }
            }
        });
        if (!note) return res.status(404).json({ error: 'Nota no encontrada' });
        if (note.processType?.code !== 'G_EMPAQUE') {
            return res.status(400).json({ error: 'Solo notas de G_EMPAQUE pueden usar consume-carrito' });
        }

        // Idempotency: check if this carritoId was already consumed
        const alreadyConsumed = note.processParameters?.carriots_consumed || [];
        if (alreadyConsumed.includes(carritoId)) {
            return res.json({ ok: true, skipped: true, reason: 'carritoId ya fue consumido previamente' });
        }

        // The note's plannedQuantity represents the full-lot target.
        // We consume proportionally: qty_this_carrito / note.targetQuantity * item.plannedQty
        // BUT wait: For Geniality Siropes, the target is usually 1, and the quantity is dynamic.
        // Let's rely on ratio: Math.min(1, carritoQty / noteTarget).
        // Wait, for siropes, `note.targetQuantity` is usually the total planned kg or liters, not units!
        // Actually, bottle templates define the units needed correctly per 1 base batch.
        const noteTarget = note.targetQuantity || 1;
        const ratio = Math.min(1, carritoQty / noteTarget);

        const consumed = [];
        for (const item of note.items) {
            if (!item.componentId) continue;
            const name = (item.component?.name || '').toUpperCase();
            
            // For siropes packaging we only consume discrete packaging items:
            const isPackaging = /(ENVASE|TAPA|BOTELLA|ETIQUETA|SELLO|CAJA|GALON|BIDON|GARRAFA|LITRO)/i.test(name);
            if (!isPackaging) continue;

            const plannedForNote = item.plannedQuantity || 0;
            const qtyForCarrito = Math.round(ratio * plannedForNote);
            if (qtyForCarrito <= 0) continue;

            const product = await _notePrisma.product.findUnique({
                where: { id: item.componentId },
                select: { productionZoneStock: true, currentStock: true, name: true }
            });
            const zone = product?.productionZoneStock || 0;
            const bodega = product?.currentStock || 0;
            const fromZone = Math.min(qtyForCarrito, Math.max(0, zone));
            // Floor-to-zero: never pull more from bodega than what's actually available
            const fromBodega = Math.min(qtyForCarrito - fromZone, Math.max(0, bodega));

            if (fromZone > 0) {
                await _notePrisma.product.update({
                    where: { id: item.componentId },
                    data: { productionZoneStock: { decrement: fromZone } }
                });
            }
            if (fromBodega > 0) {
                await _notePrisma.product.update({
                    where: { id: item.componentId },
                    data: { currentStock: { decrement: fromBodega } }
                });
            }
            consumed.push({ component: item.component?.name, qty: qtyForCarrito, fromZone, fromBodega });
        }

        const updatedConsumed = [...alreadyConsumed, carritoId];
        await _notePrisma.assemblyNote.update({
            where: { id },
            data: {
                processParameters: {
                    ...(note.processParameters || {}),
                    carriots_consumed: updatedConsumed,
                    materialsPreConsumed: true
                }
            }
        });

        await _notePrisma.auditLog.create({
            data: {
                userId: operatorId || null,
                action: 'G_EMPAQUE_CARRITO_CONSUMED',
                entity: 'AssemblyNote',
                entityId: id,
                changes: { carritoId, carritoQty, ratio, consumed }
            }
        }).catch(() => {});

        res.json({ ok: true, consumed, carritoId, carritoQty });
    } catch (err) {
        console.error('[consume-carrito]', err);
        res.status(500).json({ error: err.message });
    }
});

// Production Batch Operations
router.post('/batches/:id/close', productionBatchController.closeBatch);
router.post('/:noteId/qc', productionBatchController.recordQC);

// Photo upload for ALL production steps (weighing, coccion, empaque, etc.)
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const uploadDir = path.join(__dirname, '../../uploads/production');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${req.body.noteId || 'note'}-${req.body.context || 'photo'}-${Date.now()}${ext}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
// Endpoint dedicado de carritos (POST en vez de PATCH genérico).
// Reusa el controller principal — los carritos viven en
// `processParameters.carriots`, mismo formato Liquipops/Geniality.
const liquipopsAssemblyController = require('../controllers/assemblyNoteController');
router.post('/:id/carriots', auth, liquipopsAssemblyController.addCarrito);
router.post('/:id/package-labels', auth, liquipopsAssemblyController.persistPackageLabels);

router.post('/upload-photo', upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `/uploads/production/${req.file.filename}`;
    res.json({ url, filename: req.file.filename });
});

module.exports = router;
