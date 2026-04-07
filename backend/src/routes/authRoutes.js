const express = require('express');
const router = express.Router();
const { login, getMe, pinLogin, setPin, removePin } = require('../controllers/authController');
const { auth, roles } = require('../middleware/auth');
const { loginLimiter, pinLoginLimiter } = require('../middleware/rateLimiter');

router.post('/login', loginLimiter, login);
router.post('/pin-login', pinLoginLimiter, pinLogin);
router.get('/me', auth, getMe);
router.post('/set-pin', auth, setPin);
router.delete('/remove-pin/:userId', auth, roles('ADMIN'), removePin);

module.exports = router;
