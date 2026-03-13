const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Public endpoint - No auth middleware (or use HMAC verification if provided)
router.post('/siigo', webhookController.handleSiigoWebhook);

module.exports = router;
