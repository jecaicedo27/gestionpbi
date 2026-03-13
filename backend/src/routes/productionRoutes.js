const express = require('express');
const router = express.Router();
const productionController = require('../controllers/productionController');
const { auth, roles } = require('../middleware/auth');

router.get('/schedule', auth, productionController.getSchedule);
router.post('/', auth, roles(['ADMIN', 'LOGISTICA', 'PRODUCCION']), productionController.createProductionOrder);
router.patch('/:id', auth, roles(['ADMIN', 'LOGISTICA', 'PRODUCCION']), productionController.updateSchedule);

module.exports = router;
