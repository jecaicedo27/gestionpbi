const express = require('express');
const router = express.Router();
const multer = require('multer');
const movementController = require('../controllers/movementController');
const { auth, roles } = require('../middleware/auth');

// Multer storage in memory for Excel processing
const upload = multer({ storage: multer.memoryStorage() });

// Sync sales from Siigo
router.post('/sync-sales', auth, roles(['ADMIN', 'LOGISTICA']), movementController.syncSales);

// Upload production movements (NE) from Excel
router.post('/upload-production', auth, roles(['ADMIN', 'LOGISTICA']), upload.single('file'), movementController.uploadProductionMovements);

// Get movements summary
router.get('/summary', auth, movementController.getSummary);

module.exports = router;
