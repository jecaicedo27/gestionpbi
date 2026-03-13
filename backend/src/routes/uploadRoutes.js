const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Store images in the backend uploads directory (served via nginx proxy at /uploads)
const UPLOAD_DIR = path.join(__dirname, '../../uploads/evidence');

// Ensure directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `evidence_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Solo se permiten imágenes'));
    }
});

// POST /api/uploads/evidence — upload a single image, returns { url }
router.post('/evidence', upload.single('photo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    // Return the public URL (served by the frontend static server)
    const url = `/uploads/evidence/${req.file.filename}`;
    res.json({ url, filename: req.file.filename });
});

module.exports = router;
