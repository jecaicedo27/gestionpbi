const express = require('express');
const router = express.Router();
const materialLotZoneController = require('../controllers/materialLotZoneController');
const { auth, roles } = require('../middleware/auth');

router.use(auth);
router.use(roles('ADMIN', 'MODERADOR')); // Admin and moderators to start

// Get grouped by zones
router.get('/zones', materialLotZoneController.getLotsByZone);

// Transfer lot
router.post('/transfer', materialLotZoneController.transferZone);

// Print label
router.post('/print-label', materialLotZoneController.printLabel);

// Adjust lot (Baja/Merma)
router.post('/adjust', materialLotZoneController.adjustLot);

module.exports = router;
