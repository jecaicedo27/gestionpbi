const express = require('express');
const router = express.Router();
console.log('Loading Analytics Routes...');
const analyticsController = require('../controllers/analyticsController');
const { auth, roles } = require('../middleware/auth');

// Get Projection (Read-only)
router.get('/replenishment', auth, analyticsController.getReplenishment);

// Get Consumption Stats (Read-only)
router.get('/consumption', auth, analyticsController.getConsumption);

// Trigger Calculation (Admin/Logistica only)
router.post('/mine', auth, roles(['ADMIN', 'LOGISTICA']), analyticsController.runMining);

const analyticsExecutiveController = require('../controllers/analyticsExecutiveController');

// Executive Stats
router.get('/executive', auth, analyticsExecutiveController.getExecutiveStats);

// Sales Analytics by Client
const salesAnalyticsController = require('../controllers/salesAnalyticsController');
router.get('/sales/by-client', auth, roles(['ADMIN']), salesAnalyticsController.getSalesByClient);

module.exports = router;
