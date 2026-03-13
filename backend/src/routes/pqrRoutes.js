const express = require('express');
const router = express.Router();
const pqrController = require('../controllers/pqrController');
const { auth: protect, roles: authorize } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure upload storage
const uploadDir = path.join(__dirname, '../../uploads/pqr');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Formato de archivo no soportado'), false);
        }
    }
});

const pqrAnalyticsController = require('../controllers/pqrAnalyticsController');

router.post('/', protect, upload.array('evidence', 5), pqrController.createPQR);
router.get('/', protect, pqrController.getPQRs);
router.get('/analytics', protect, authorize('ADMIN', 'CALIDAD'), pqrAnalyticsController.getPQRAnalytics);
router.get('/analytics/recall-report', protect, authorize('ADMIN', 'CALIDAD'), pqrAnalyticsController.getRecallReport);
router.get('/analytics/advanced-validation', protect, authorize('ADMIN', 'CALIDAD'), pqrAnalyticsController.getAdvancedLotValidation);
router.get('/recall-lots', protect, pqrAnalyticsController.getRecallLots);
router.patch('/recall-lots/:lotNumber/collection-status', protect, pqrAnalyticsController.updateRecallLotCollectionStatus);
router.get('/valid-lots', protect, pqrAnalyticsController.getValidLots);
router.get('/reporting-parties', protect, pqrController.getReportingParties);
router.get('/:id', protect, pqrController.getPQRById);
router.patch('/:id/status', protect, authorize('ADMIN', 'CALIDAD', 'LOGISTICA', 'CONTABILIDAD'), pqrController.updatePQRStatus);
router.post('/:id/billing', protect, authorize('ADMIN', 'CONTABILIDAD', 'COMERCIAL'), upload.fields([{ name: 'file', maxCount: 1 }, { name: 'accountStatement', maxCount: 1 }]), pqrController.uploadBillingDocument);
router.post('/:id/dispatch', protect, authorize('ADMIN', 'LOGISTICA'), upload.single('file'), pqrController.dispatchPQR);

module.exports = router;
