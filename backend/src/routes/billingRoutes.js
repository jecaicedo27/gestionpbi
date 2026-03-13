const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billingController');
const { auth, roles } = require('../middleware/auth');

router.post('/generate', auth, roles(['ADMIN', 'LOGISTICA']), billingController.generateInvoice);

module.exports = router;
