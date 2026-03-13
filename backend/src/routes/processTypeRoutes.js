const express = require('express');
const router = express.Router();
const processTypeController = require('../controllers/processTypeController');

// GET /api/process-types - Listar todos los tipos de proceso
router.get('/', processTypeController.listProcessTypes);

// GET /api/process-types/:id - Obtener un tipo de proceso
router.get('/:id', processTypeController.getProcessType);

// POST /api/process-types - Crear nuevo tipo de proceso
router.post('/', processTypeController.createProcessType);

// PATCH /api/process-types/:id - Actualizar tipo de proceso
router.patch('/:id', processTypeController.updateProcessType);

// DELETE /api/process-types/:id - Desactivar tipo de proceso
router.delete('/:id', processTypeController.deleteProcessType);

module.exports = router;
