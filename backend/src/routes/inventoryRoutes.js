const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const lotController = require('../controllers/lotController');
const { auth } = require('../middleware/auth');

router.get('/dashboard', auth, inventoryController.getDashboard);
router.get('/list', auth, inventoryController.getAllProducts);
router.get('/products', auth, inventoryController.getProductsSimple);
router.post('/sync', auth, inventoryController.syncFromSiigo);
router.post('/product/:id/config', auth, inventoryController.updateProductConfig);

// ── Lot Management ──
router.get('/lots', auth, lotController.getLots);
router.get('/lots/stock-by-zone', auth, lotController.getStockByZone);
router.get('/lots/products-without-lots', auth, lotController.getProductsWithoutLots);
router.get('/lots/traceability', auth, lotController.getTraceability);
router.get('/lots/:id/history', auth, lotController.getLotHistory);
router.post('/lots', auth, lotController.createLot);
router.post('/lots/:id/consume', auth, lotController.consumeLot);
router.delete('/lots/:id', auth, lotController.deleteLot);
router.patch('/lots/:id/link', auth, lotController.linkLot);

module.exports = router;
