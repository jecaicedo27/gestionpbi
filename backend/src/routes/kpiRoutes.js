const express = require('express');
const router = express.Router();
const { getProductionKpis, getOperators, getScheduleAdherence } = require('../controllers/kpiController');
const { auth } = require('../middleware/auth');

router.get('/', auth, getProductionKpis);
router.get('/operators', auth, getOperators);
router.get('/schedule-adherence', auth, getScheduleAdherence);

module.exports = router;
