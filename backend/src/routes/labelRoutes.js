const express = require('express');
const router = express.Router();
const labelController = require('../controllers/labelController');
const { auth } = require('../middleware/auth');

router.post('/verify', auth, labelController.verifyQR);

module.exports = router;
