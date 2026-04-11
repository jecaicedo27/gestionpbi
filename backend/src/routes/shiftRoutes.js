const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const sc = require('../controllers/shiftController');

// Employees
router.get('/employees',     auth, sc.getEmployees);
router.post('/employees',    auth, sc.createEmployee);
router.patch('/employees/:id', auth, sc.updateEmployee);

// Weekly schedule
router.get('/weeks',              auth, sc.getWeekSchedule);
router.post('/weeks/save',        auth, sc.saveWeekSchedule);
router.post('/weeks/:id/publish', auth, sc.publishWeek);
router.post('/weeks/generate-next', auth, sc.generateNextWeek);

// Absences
router.get('/absences',                        auth, sc.getAbsences);
router.post('/absences',                       auth, sc.registerAbsence);
router.get('/suggest-replacement/:employeeId', auth, sc.suggestReplacement);

module.exports = router;
