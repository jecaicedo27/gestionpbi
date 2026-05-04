/**
 * attendanceRoutes.js
 * Rutas del módulo de control de ingreso a planta.
 *
 * Públicas (kiosko, sin JWT):
 *   GET  /api/attendance/find-by-cedula/:cedula
 *   POST /api/attendance/match-face
 *   POST /api/attendance/checkin
 *   POST /api/attendance/checkout
 *   GET  /api/attendance/status/:employeeId
 *
 * Admin (JWT requerido):
 *   GET  /api/attendance/present
 *   GET  /api/attendance/dashboard
 *   GET  /api/attendance/history
 *   GET  /api/attendance/hours/:employeeId
 *   GET  /api/attendance/punctuality
 *   GET  /api/attendance/overtime
 *   GET  /api/attendance/employees
 *   PUT  /api/attendance/employees/:id/face
 *   PUT  /api/attendance/employees/:id/pin
 *   PUT  /api/attendance/employees/:id/cedula
 *   POST /api/attendance/employees/:id/manual-record
 *   GET  /api/attendance/shift-definitions
 *   PUT  /api/attendance/shift-definitions/:id
 */

const express = require('express');
const router = express.Router();
const { auth, roles } = require('../middleware/auth');
const ac = require('../controllers/attendanceController');

const ADMIN_ROLES = ['ADMIN', 'RECURSOS_HUMANOS'];

// ── Públicas (kiosko) ────────────────────────────────────────────────────────
router.get('/find-by-cedula/:cedula',   ac.findByCedula);
router.post('/match-face',              ac.matchFace);
router.post('/checkin',                 ac.checkIn);
router.post('/checkout',               ac.checkOut);
router.get('/status/:employeeId',       ac.getStatus);

// ── Marcaje multi-método (PIN / Cédula / Cara) — público sin auth ────────────
router.post('/pin-mark',                ac.pinMark);
router.post('/cedula-mark',             ac.cedulaMark);
router.post('/face-mark',               ac.faceMark);

// ── Admin: presencia y dashboard ─────────────────────────────────────────────
router.get('/present',    auth, ac.getPresent);
router.get('/dashboard',  auth, ac.getDashboard);

// ── Admin: historial ─────────────────────────────────────────────────────────
router.get('/history',    auth, ac.getHistory);

// ── Admin: reportes ──────────────────────────────────────────────────────────
router.get('/hours/:employeeId',  auth, ac.getHours);
router.get('/punctuality',        auth, ac.getPunctuality);
router.get('/overtime',           auth, ac.getOvertime);
router.get('/payroll-summary',    auth, ac.getPayrollSummary);
router.get('/payroll-config',     auth, ac.getPayrollConfig);
router.put('/payroll-config',     auth, roles(ADMIN_ROLES), ac.updatePayrollConfig);
router.get('/labor-novelties',    auth, ac.getLaborNovelties);
router.post('/labor-novelties',   auth, roles(ADMIN_ROLES), ac.createLaborNovelty);
router.delete('/labor-novelties/:id', auth, roles(ADMIN_ROLES), ac.deleteLaborNovelty);

// ── Aprobaciones de horas extra ──────────────────────────────────────────────
router.get('/overtime-approvals',          auth, ac.listOvertimeApprovals);
router.post('/overtime-approvals',         auth, roles(ADMIN_ROLES), ac.createOvertimeApproval);
router.delete('/overtime-approvals/:id',   auth, roles(ADMIN_ROLES), ac.deleteOvertimeApproval);
router.get('/payroll-closures',   auth, ac.getPayrollClosures);
router.get('/payroll-closures/:id', auth, ac.getPayrollClosureDetail);
router.get('/payroll-closures/:id/export', auth, ac.exportPayrollClosure);
router.post('/payroll-closures/close', auth, roles(ADMIN_ROLES), ac.closePayrollPeriod);
router.post('/payroll-closures/:id/reopen', auth, roles(ADMIN_ROLES), ac.reopenPayrollClosure);

// ── Admin: gestión de empleados del kiosko ───────────────────────────────────
router.get('/employees',                          auth, ac.getEmployees);
router.post('/employees/from-user/:userId',       auth, roles(ADMIN_ROLES), ac.createFromUser);
router.put('/employees/:id/face',                 auth, roles(ADMIN_ROLES), ac.enrollFace);
router.put('/employees/:id/pin',                  auth, roles(ADMIN_ROLES), ac.setPin);
router.put('/employees/:id/cedula',               auth, roles(ADMIN_ROLES), ac.setCedula);
router.post('/employees/:id/manual-record',       auth, roles(ADMIN_ROLES), ac.manualRecord);

// ── Admin: definiciones de turno ─────────────────────────────────────────────
router.get('/shift-definitions',        auth, ac.getShiftDefinitions);
router.put('/shift-definitions/:id',    auth, roles(['ADMIN']), ac.updateShiftDefinition);

// ── Vigilancia de puerta (YOLOv8) ────────────────────────────────────────────
router.get('/door-crossings',         auth, ac.getDoorCrossings);
router.get('/door-crossings/recent',  auth, ac.getDoorCrossingsRecent);
router.get('/door-crossings/summary', auth, ac.getDoorCrossingsSummary);

module.exports = router;
