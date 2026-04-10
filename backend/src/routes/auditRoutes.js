const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const { auth, roles } = require('../middleware/auth');

// Auditoría accesible para ADMIN y QUIMICO, tal como se solicitó en el plan
router.get('/', auth, roles(['ADMIN', 'QUIMICO']), auditController.getAuditReport);

module.exports = router;
