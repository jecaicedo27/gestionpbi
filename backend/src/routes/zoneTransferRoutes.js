const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/zoneTransferController');

router.get('/', ctrl.listTransfers);
router.get('/zone-stock', ctrl.getZoneStock);
router.get('/search-products', ctrl.searchProducts);
router.get('/available-lots/:productId', ctrl.getAvailableLots);
router.post('/transfer-in', ctrl.transferIn);
router.post('/transfer-out', ctrl.transferOut);

module.exports = router;
