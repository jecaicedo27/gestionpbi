const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { auth } = require('../middleware/auth');
const microController = require('../controllers/microController');

const router = express.Router();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../uploads/micro');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `micro_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB for lab PDFs

// Config endpoints
router.get('/sampling-points', auth, microController.getSamplingPoints);
router.get('/parameters', auth, microController.getParameters);

// Schedule
router.get('/schedule', auth, microController.getWeekSchedule);

// Dashboard & Trends
router.get('/dashboard', auth, microController.getDashboard);
router.get('/trends', auth, microController.getTrendData);

// Samples CRUD
router.get('/samples', auth, microController.getSamples);
router.get('/samples/:id', auth, microController.getSampleById);
router.post('/samples', auth, upload.single('report'), microController.createSample);
router.patch('/samples/:id/results', auth, upload.single('report'), microController.updateSampleResults);

module.exports = router;
