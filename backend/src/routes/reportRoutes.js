
const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const kardexController = require('../controllers/kardexController');
const { auth } = require('../middleware/auth');

router.get('/production', auth, reportController.generateProductionReport);
router.get('/kardex/production-zone/:productId', auth, kardexController.getProductionZoneKardex);
router.get('/purchasing', auth, reportController.generatePurchasingReport);

module.exports = router;
