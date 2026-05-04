const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const ctrl = require('../controllers/cleaningController');

router.use(auth);

// Personal de aseo (para asignar tareas)
router.get('/staff', ctrl.listStaff);

// Zonas
router.get('/zones', ctrl.listZones);
router.post('/zones', ctrl.createZone);
router.put('/zones/:id', ctrl.updateZone);

// Tareas
router.get('/tasks', ctrl.listTasks);
router.post('/tasks', ctrl.createTask);
router.put('/tasks/:id', ctrl.updateTask);
router.delete('/tasks/:id', ctrl.deleteTask);
router.post('/tasks/extra', ctrl.assignExtraTask);

// Ejecuciones (Leddy)
router.get('/today', ctrl.getTodayTasks);
router.post('/executions/:id/start', ctrl.startExecution);
router.post('/executions/:id/complete', ctrl.completeExecution);
router.post('/executions/:id/skip', ctrl.skipExecution);

// Verificación (Diana)
router.get('/verifications/pending', ctrl.listPendingVerifications);
router.post('/executions/:id/verify', ctrl.verifyExecution);

// Insumos
router.get('/supplies', ctrl.listSupplies);
router.post('/supplies', ctrl.createSupply);
router.put('/supplies/:id', ctrl.updateSupply);
router.post('/supplies/:id/alert', ctrl.reportSupplyLow);
router.get('/alerts', ctrl.listAlerts);
router.put('/alerts/:id/resolve', ctrl.resolveAlert);

// Reportes
router.get('/reports/daily', ctrl.getDailyReport);
router.get('/reports/weekly', ctrl.getWeeklyReport);
router.post('/regenerate-today', ctrl.regenerateToday);

module.exports = router;
