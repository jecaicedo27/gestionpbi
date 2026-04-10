const express = require('express');
const router = express.Router();
const rpaController = require('../controllers/rpaController');
const { auth, roles } = require('../middleware/auth');

// Siigo Assembly Note RPA
router.post('/siigo-assembly', auth, roles(['ADMIN', 'PRODUCCION', 'OPERARIO_PICKING']), rpaController.createSiigoAssemblyNote);

// RPA History
router.get('/history', auth, roles(['ADMIN', 'PRODUCCION']), rpaController.getHistory);
router.post('/:id/retry', auth, roles(['ADMIN', 'PRODUCCION']), rpaController.retryExecution);

// Queue status
router.get('/queue-status', auth, roles(['ADMIN', 'PRODUCCION']), rpaController.getQueueStatus);

// Orphan notes (COMPLETED EMPAQUE notes with no RPA execution)
router.get('/orphan-notes', auth, roles(['ADMIN', 'PRODUCCION']), rpaController.getOrphanNotes);
router.post('/dispatch-orphan', auth, roles(['ADMIN', 'PRODUCCION']), rpaController.dispatchOrphan);

module.exports = router;
