const express = require('express');
const router = express.Router();
const { getProductionKpis, getOperators } = require('../controllers/kpiController');
const { auth } = require('../middleware/auth');

router.get('/', auth, getProductionKpis);
router.get('/operators', auth, getOperators);

module.exports = router;
