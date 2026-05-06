const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/shiftDisciplineController');
const { auth } = require('../middleware/auth');

router.get('/current', auth, ctrl.getCurrent);
router.get('/previous', auth, ctrl.getPrevious);
router.get('/leader-ranking', auth, ctrl.leaderRanking);
router.get('/history', auth, ctrl.history);
router.get('/bonus', auth, ctrl.monthlyBonus);
router.get('/runs/:id', auth, ctrl.getRunDetail);
router.post('/runs/:id/recompute', auth, ctrl.recomputeRun);
router.post('/:id/refresh', auth, ctrl.refresh);
router.post('/:id/close', auth, ctrl.close);

// Días especiales (festivos / no-laborados manualmente)
router.get('/non-work-days', auth, ctrl.listNonWorkDays);
router.post('/non-work-days', auth, ctrl.addNonWorkDay);
router.delete('/non-work-days/:date', auth, ctrl.removeNonWorkDay);

// Analítica de tiempos para ajustar cronograma a la dinámica real
router.get('/analytics/timing-stats', auth, ctrl.timingStats);

module.exports = router;
