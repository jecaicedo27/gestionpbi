const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');
const { auth } = require('../middleware/auth'); // Ensure protected

router.get('/', auth, configController.getConfig);
router.get('/pqr-types', auth, configController.getPqrTypes);
router.put('/', auth, configController.updateConfig);

module.exports = router;
