const express = require('express');
const router = express.Router();
const sanitationController = require('../controllers/sanitationController');

// Configuración (Maestros)
router.get('/config', sanitationController.getSanitationConfig);
router.post('/areas', sanitationController.createArea);
router.put('/areas/:id', sanitationController.updateArea);
router.post('/chemicals', sanitationController.createChemical);
router.put('/chemicals/:id', sanitationController.updateChemical);

// Componentes de Equipos (Checklist Parts)
router.get('/areas/:areaId/components', sanitationController.listComponents);
router.post('/components', sanitationController.createComponent);
router.put('/components/:id', sanitationController.updateComponent);

// Registros de Saneamiento (POES)
router.get('/records', sanitationController.listRecords);
router.post('/records', sanitationController.createRecord);
router.patch('/records/:id/verify', sanitationController.verifyRecord);

// Check Items individuales
router.put('/check-items/:id', sanitationController.updateCheckItem);

module.exports = router;
