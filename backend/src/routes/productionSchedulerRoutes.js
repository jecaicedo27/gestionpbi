const express = require('express');
const router = express.Router();
const productionSchedulerController = require('../controllers/productionSchedulerController');
const { auth } = require('../middleware/auth');

router.get('/suggestions', auth, productionSchedulerController.getSuggestions);
router.get('/mix/:flavor', auth, productionSchedulerController.calculateBatchMix);
router.get('/schedule', auth, productionSchedulerController.getSchedule);
router.post('/schedule', auth, productionSchedulerController.createBatch);
router.delete('/all', auth, productionSchedulerController.deleteAllBatches);
router.put('/:id', auth, productionSchedulerController.updateBatch);
router.delete('/:id', auth, productionSchedulerController.deleteBatch);

module.exports = router;
