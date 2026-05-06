const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const lotController = require('../controllers/lotController');
const { auth } = require('../middleware/auth');

router.get('/dashboard', auth, inventoryController.getDashboard);
router.get('/picked-summary', auth, inventoryController.getPickedSummary);
router.get('/list', auth, inventoryController.getAllProducts);
router.get('/products', auth, inventoryController.getProductsSimple);
router.post('/sync', auth, inventoryController.syncFromSiigo);
router.get('/physical-status', auth, inventoryController.physicalStatus);
router.post('/physical-adjust', auth, inventoryController.physicalAdjust);
router.post('/product/:id/config', auth, inventoryController.updateProductConfig);
router.get('/product/:id/reservation', auth, inventoryController.getProductReservation);
router.get('/products/:productId/lot-context', auth, lotController.getProductLotContext);
router.get('/products/:productId/pack-options', auth, lotController.getProductPackOptions);
router.get('/unassigned-bulk-ingress/availability', auth, lotController.getBulkIngressAvailability);
router.post('/products/:productId/pack-options', auth, lotController.createProductPackOption);
router.patch('/pack-options/:packOptionId', auth, lotController.updateProductPackOption);
router.delete('/pack-options/:packOptionId', auth, lotController.deleteProductPackOption);
router.post('/unassigned-bulk-ingress', auth, lotController.bulkIngressUnassigned);

// ── Lot Management ──
router.get('/lots', auth, lotController.getLots);
router.get('/lots/stock-by-zone', auth, lotController.getStockByZone);
router.get('/lots/products-without-lots', auth, lotController.getProductsWithoutLots);
router.get('/lots/traceability', auth, lotController.getTraceability);
router.get('/lots/:id/history', auth, lotController.getLotHistory);
router.post('/lots', auth, lotController.createLot);
router.post('/lots/:id/package-labels', auth, lotController.preparePackageLabels);
router.post('/lots/:id/print-label', auth, lotController.markLabelPrinted);
router.post('/lots/:id/consume', auth, lotController.consumeLot);
router.post('/package-labels/validate-scan', auth, lotController.validatePackageScan);
router.delete('/package-labels/:packageCode', auth, lotController.voidPackageLabel);
router.delete('/lots/:id', auth, lotController.deleteLot);
router.delete('/finished-lots/:id', auth, lotController.deleteLot);
router.patch('/lots/:id/link', auth, lotController.linkLot);
router.post('/lots/transfer-zone', auth, lotController.transferZone);

module.exports = router;
