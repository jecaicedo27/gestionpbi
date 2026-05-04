const express = require('express');
const router = express.Router();
const productionSchedulerController = require('../controllers/productionSchedulerController');
const { auth } = require('../middleware/auth');

router.get('/suggestions', auth, productionSchedulerController.getSuggestions);
router.get('/mix/:flavor', auth, productionSchedulerController.calculateBatchMix);
router.get('/demand', auth, productionSchedulerController.getFlavorDemand);
router.get('/demand/:flavor', auth, productionSchedulerController.getFlavorDemand);
router.get('/schedule', auth, productionSchedulerController.getSchedule);
router.get('/operational-meta', auth, productionSchedulerController.getOperationalMeta);
router.get('/failure-stats', auth, productionSchedulerController.failureStats);
router.post('/schedule', auth, productionSchedulerController.createBatch);
router.delete('/all', auth, productionSchedulerController.deleteAllBatches);
router.post('/:line/reschedule-shift', auth, productionSchedulerController.rescheduleShift);
router.put('/:id', auth, productionSchedulerController.updateBatch);
router.patch('/:id/aux-action', auth, productionSchedulerController.auxAction);
router.delete('/:id', auth, productionSchedulerController.deleteBatch);
// router.post('/batches/:id/output-targets', auth, productionSchedulerController.addOutputTarget);
// router.patch('/batches/:id/output-targets', auth, productionSchedulerController.updateOutputTarget);

module.exports = router;
