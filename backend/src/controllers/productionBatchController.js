const productionBatchService = require('../services/productionBatchService');

/**
 * Extension for production controller to handle batch closure and QC
 */
const productionBatchController = {
    /**
     * Close a batch and update inventory
     */
    closeBatch: async (req, res) => {
        try {
            const { id } = req.params;
            const { operatorId } = req.body;
            const result = await productionBatchService.closeBatch(id, operatorId);
            res.json(result);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    },

    /**
     * Record QC check
     */
    recordQC: async (req, res) => {
        try {
            const { noteId } = req.params;
            const { operatorId, ...data } = req.body;
            const result = await productionBatchService.recordQualityCheck(noteId, data, operatorId);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
};

module.exports = productionBatchController;
