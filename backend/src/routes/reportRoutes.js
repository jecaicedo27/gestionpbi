
const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { auth } = require('../middleware/auth');

router.get('/production', auth, reportController.generateProductionReport);
router.get('/purchasing', auth, reportController.generatePurchasingReport);

module.exports = router;
