const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const { auth, roles } = require('../middleware/auth');

// All cart routes require authentication as distributor
router.get('/', auth, cartController.getCart);
router.post('/reserve', auth, cartController.reserve);
router.post('/heartbeat', auth, cartController.heartbeat);
router.delete('/release/:productId', auth, cartController.release);
router.delete('/clear', auth, cartController.clearCart);

module.exports = router;
