const express = require('express');
const router = express.Router();
const assemblyNoteController = require('../controllers/assemblyNoteController');
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
router.post('/:id/complete', assemblyNoteController.completeNote);

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
router.post('/upload-photo', upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `/uploads/production/${req.file.filename}`;
    res.json({ url, filename: req.file.filename });
});

module.exports = router;
