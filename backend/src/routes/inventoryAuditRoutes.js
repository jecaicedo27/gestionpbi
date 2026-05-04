const router = require('express').Router();
const { auth } = require('../middleware/auth');
const inventoryAuditController = require('../controllers/inventoryAuditController');

router.get('/run', auth, inventoryAuditController.runAudit);

module.exports = router;
