const express = require('express');
const { auth, roles } = require('../middleware/auth');
const productiveTraceabilityController = require('../controllers/productiveTraceabilityController');

const router = express.Router();

router.get(
    '/batches',
    auth,
    roles('ADMIN', 'CALIDAD', 'PRODUCCION', 'LOGISTICA', 'CONTABILIDAD', 'DIRECTOR_TECNICO', 'LIDER_OPERACIONES'),
    productiveTraceabilityController.listBatches
);

router.get(
    '/batches/:id',
    auth,
    roles('ADMIN', 'CALIDAD', 'PRODUCCION', 'LOGISTICA', 'CONTABILIDAD', 'DIRECTOR_TECNICO', 'LIDER_OPERACIONES'),
    productiveTraceabilityController.getBatchDetail
);

module.exports = router;
