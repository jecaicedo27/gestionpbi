const express = require('express');
const router = express.Router();
const { login, getMe } = require('../controllers/authController');
const { auth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');

router.post('/login', loginLimiter, login);
router.get('/me', auth, getMe);

module.exports = router;
