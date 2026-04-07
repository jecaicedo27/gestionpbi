const express = require('express');
const router = express.Router();
const formulaController = require('../controllers/genialityFormulaController');

// GET /api/formulas - Listar todas las formulaciones
router.get('/', formulaController.listFormulas);

// GET /api/formulas/:id - Obtener una formulación
router.get('/:id', formulaController.getFormula);

// POST /api/formulas - Crear nueva formulación
router.post('/', formulaController.createFormula);

// PATCH /api/formulas/:id - Actualizar formulación
router.patch('/:id', formulaController.updateFormula);

// POST /api/formulas/:id/approve - Aprobar formulación
router.post('/:id/approve', formulaController.approveFormula);

// POST /api/formulas/:id/calculate-cost - Calcular costo
router.post('/:id/calculate-cost', formulaController.calculateFormulaCost);

// DELETE /api/formulas/:id - Eliminar formulación (solo no aprobadas)
router.delete('/:id', formulaController.deleteFormula);

module.exports = router;
