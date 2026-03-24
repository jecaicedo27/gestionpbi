const express = require('express');
const multer = require('multer');
const { auth, roles } = require('../middleware/auth');
const microController = require('../controllers/microController');

const router = express.Router();

const ALLOWED_FILE_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif']);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024,
        files: 13
    },
    fileFilter: (req, file, cb) => {
        const extension = (file.originalname || '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
        const isImage = file.mimetype?.startsWith('image/');
        const isDocument = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ].includes(file.mimetype);

        if (isImage || isDocument || (extension && ALLOWED_FILE_EXTENSIONS.has(extension))) {
            cb(null, true);
            return;
        }

        cb(new Error('Solo se permiten imágenes, PDF o documentos de Office.'), false);
    }
});

// Config endpoints
router.get('/sampling-points', auth, microController.getSamplingPoints);
router.post('/sampling-points', auth, roles('ADMIN', 'CALIDAD'), microController.createSamplingPoint);
router.patch('/sampling-points/:id', auth, roles('ADMIN', 'CALIDAD'), microController.updateSamplingPoint);
router.get('/parameters', auth, microController.getParameters);
router.get('/context', auth, microController.getSamplingContext);

// Schedule
router.get('/schedule', auth, microController.getWeekSchedule);
router.post('/schedule/generate-week', auth, microController.generateWeekPlan);
router.post('/schedule/entries', auth, microController.createScheduleEntry);
router.patch('/schedule/entries/:id', auth, microController.updateScheduleEntry);
router.post('/schedule/entries/:id/cancel', auth, microController.cancelScheduleEntry);
router.post('/schedule/entries/:id/reschedule', auth, microController.rescheduleScheduleEntry);
router.delete('/schedule/entries/:id', auth, microController.deleteScheduleEntry);

// Dashboard & Trends
router.get('/dashboard', auth, microController.getDashboard);
router.get('/trends', auth, microController.getTrendData);
router.post('/sample-label', auth, microController.generateSampleLabelPdf);

// Samples CRUD
router.get('/samples', auth, microController.getSamples);
router.get('/samples/:id', auth, microController.getSampleById);
router.post('/samples', auth, upload.fields([{ name: 'report', maxCount: 1 }, { name: 'attachments', maxCount: 12 }]), microController.createSample);
router.patch('/samples/:id/results', auth, upload.fields([{ name: 'report', maxCount: 1 }, { name: 'attachments', maxCount: 12 }]), microController.updateSampleResults);
router.patch('/samples/:id/internal-case', auth, microController.updateInternalCase);
router.patch('/samples/:id/internal-supports', auth, upload.fields([{ name: 'attachments', maxCount: 12 }]), microController.updateInternalSupports);
router.post('/samples/:id/accept-internal', auth, microController.acceptInternalSample);
router.post('/samples/:id/internal-logs', auth, microController.addInternalLog);
router.post('/samples/:id/internal-results', auth, microController.saveInternalResults);
router.post('/samples/:id/internal-review', auth, microController.reviewInternalSample);
router.post('/samples/:id/finalize-internal', auth, microController.finalizeInternalSample);

module.exports = router;
