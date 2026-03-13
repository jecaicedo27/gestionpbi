const express = require('express');
const router = express.Router();
const internalPqrController = require('../controllers/internalPqrController');
const { auth: protect, roles: authorize } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Reuse the same upload directory as external PQR
const uploadDir = path.join(__dirname, '../../uploads/pqr');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Formato no soportado'), false);
        }
    }
});

// Routes
router.post('/', protect, authorize('ADMIN', 'CALIDAD', 'PRODUCCION'), upload.array('evidence', 10), internalPqrController.createInternalPQR);
router.get('/', protect, authorize('ADMIN', 'CALIDAD', 'CONTABILIDAD', 'PRODUCCION'), internalPqrController.getInternalPQRs);
router.get('/:id', protect, authorize('ADMIN', 'CALIDAD', 'CONTABILIDAD', 'PRODUCCION'), internalPqrController.getInternalPQRById);
router.patch('/:id/status', protect, authorize('ADMIN', 'CALIDAD', 'CONTABILIDAD'), internalPqrController.updateInternalPQRStatus);
router.post('/:id/adjustment', protect, authorize('ADMIN', 'CONTABILIDAD'), upload.single('file'), internalPqrController.uploadAdjustmentDocument);

module.exports = router;
