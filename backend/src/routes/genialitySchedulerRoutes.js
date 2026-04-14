const express = require('express');
const router = express.Router();
const productionSchedulerController = require('../controllers/genialitySchedulerController');
const { auth } = require('../middleware/auth');

router.get('/suggestions', auth, productionSchedulerController.getSuggestions);
router.get('/mix/:flavor', auth, productionSchedulerController.calculateBatchMix);
router.get('/demand', auth, productionSchedulerController.getFlavorDemand);
router.get('/demand/:flavor', auth, productionSchedulerController.getFlavorDemand);
router.get('/schedule', auth, productionSchedulerController.getSchedule);
router.post('/schedule', auth, productionSchedulerController.createBatch);
router.delete('/all', auth, productionSchedulerController.deleteAllBatches);
router.put('/:id', auth, productionSchedulerController.updateBatch);
router.delete('/:id', auth, productionSchedulerController.deleteBatch);

const monitorController = require('../controllers/genialityMonitorController');
router.get('/monitor/batches', auth, monitorController.getBatchMonitorData);

module.exports = router;
