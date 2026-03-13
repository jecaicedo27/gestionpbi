const express = require('express');
const router = express.Router();
const assemblyTemplateController = require('../controllers/assemblyTemplateController');

// GET /api/assembly-templates - Listar todas las plantillas
router.get('/', assemblyTemplateController.listAssemblyTemplates);

// GET /api/assembly-templates/:id - Obtener una plantilla
router.get('/:id', assemblyTemplateController.getAssemblyTemplate);

// POST /api/assembly-templates - Crear nueva plantilla
router.post('/', assemblyTemplateController.createAssemblyTemplate);

// PATCH /api/assembly-templates/:id - Actualizar plantilla
router.patch('/:id', assemblyTemplateController.updateAssemblyTemplate);

// DELETE /api/assembly-templates/:id - Desactivar plantilla
router.delete('/:id', assemblyTemplateController.deleteAssemblyTemplate);

// POST /api/assembly-templates/:id/clone - Clonar plantilla
router.post('/:id/clone', assemblyTemplateController.cloneAssemblyTemplate);

module.exports = router;
