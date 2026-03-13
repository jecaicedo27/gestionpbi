const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const workflowController = require('../controllers/orderWorkflowController');

// Director Logística actions
router.post('/:id/approve', auth, workflowController.approveOrder);
router.post('/:id/reject', auth, workflowController.rejectOrder);

// Operario Picking actions
router.post('/:id/start-picking', auth, workflowController.startPicking);
router.post('/:id/scan', auth, workflowController.scanItem);
router.post('/:id/complete-picking', auth, workflowController.completePicking);

// Progress tracking
router.get('/:id/picking-progress', auth, workflowController.getPickingProgress);

module.exports = router;
