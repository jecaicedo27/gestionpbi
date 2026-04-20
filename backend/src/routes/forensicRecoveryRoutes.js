const express = require('express');
const { auth, roles } = require('../middleware/auth');
const forensicRecoveryController = require('../controllers/forensicRecoveryController');

const router = express.Router();

router.get('/summary', auth, roles('ADMIN', 'QUIMICO'), forensicRecoveryController.getSummary);
router.get('/records', auth, roles('ADMIN', 'QUIMICO'), forensicRecoveryController.listRecords);

module.exports = router;
