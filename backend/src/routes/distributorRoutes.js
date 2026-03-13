const express = require('express');
const router = express.Router();
const distributorController = require('../controllers/distributorController');
const { auth, roles } = require('../middleware/auth');

// All routes require DISTRIBUIDOR role (+ ADMIN/DIRECTOR for oversight)
router.use(auth);
router.use(roles(['DISTRIBUIDOR', 'ADMIN', 'LOGISTICA']));

/**
 * GET /api/distributor/available-inventory
 * View available inventory grouped by flavor and size
 */
router.get('/available-inventory', distributorController.getAvailableInventory);

/**
 * POST /api/distributor/orders
 * Create a new order
 */
router.post('/orders', distributorController.createOrder);

/**
 * GET /api/distributor/orders
 * Get my orders (with optional status filter)
 */
router.get('/orders', distributorController.getMyOrders);

/**
 * DELETE /api/distributor/orders/:id
 * Cancel a pending order
 */
router.delete('/orders/:id', distributorController.cancelOrder);

/**
 * Legacy: GET /api/distributor/catalog
 * Backwards compatibility
 */
router.get('/catalog', distributorController.getCatalog);

module.exports = router;
