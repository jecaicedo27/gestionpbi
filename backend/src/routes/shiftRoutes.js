const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const sc = require('../controllers/shiftController');
const hc = require('../controllers/shiftHandoffController');

// Employees
router.get('/employees',     auth, sc.getEmployees);
router.post('/employees',    auth, sc.createEmployee);
router.patch('/employees/:id', auth, sc.updateEmployee);
router.delete('/employees/:id', auth, sc.deleteEmployee);

// Weekly schedule
router.get('/weeks',              auth, sc.getWeekSchedule);
router.post('/weeks/save',        auth, sc.saveWeekSchedule);
router.post('/weeks/:id/publish', auth, sc.publishWeek);
router.post('/weeks/generate-next', auth, sc.generateNextWeek);

// Absences
router.get('/absences',                        auth, sc.getAbsences);
router.post('/absences',                       auth, sc.registerAbsence);
router.delete('/absences/:id',                 auth, sc.deleteAbsence);
router.get('/suggest-replacement/:employeeId', auth, sc.suggestReplacement);

// Shift Handoff (Entrega de Turno)
router.get('/handoff/checklists',              auth, hc.getChecklists);
router.get('/handoff/today',                   auth, hc.getTodayHandoffs);
router.get('/handoff/block-status',            auth, hc.getBlockStatus);
router.post('/handoff',                        auth, hc.createHandoff);
router.post('/handoff/:id/approve',            auth, hc.approveHandoff);
router.post('/handoff/:id/reject',             auth, hc.rejectHandoff);
router.get('/handoff/:id',                     auth, hc.getHandoffDetail);

module.exports = router;

