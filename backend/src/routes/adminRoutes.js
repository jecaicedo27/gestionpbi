const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const reportController = require('../controllers/reportController');
const networkIpsController = require('../controllers/networkIpsController');
const { auth, roles } = require('../middleware/auth');

// Protected Routes (Admin Only)
router.use(auth, roles(['ADMIN']));

// User Management
router.get('/users', userController.getUsers);
router.post('/users', userController.createUser);
router.patch('/users/:id', userController.updateUser);
router.delete('/users/:id', userController.deleteUser);

// Network Access Control (allowed IPs for PIN login)
router.get('/network-ips', networkIpsController.list);
router.post('/network-ips/register-current', networkIpsController.registerCurrent);
router.post('/network-ips', networkIpsController.addManual);
router.delete('/network-ips/:ip', networkIpsController.remove);

// Reports
// router.get('/reports/sales', reportController.getSalesReport);

// Inventory sync audit (read-only) — descuadre Siigo vs gestionpbi
router.get('/inventory-sync-report', async (req, res) => {
    try {
        const { runAudit } = require('../scripts/auditInventorySync');
        const threshold = parseInt(req.query.threshold || '1000', 10);
        const result = await runAudit({ threshold });
        res.json(result);
    } catch (e) {
        console.error('[inventory-sync-report]', e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
