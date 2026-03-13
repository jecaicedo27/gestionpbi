const mrpService = require('../services/mrpService');

/**
 * Controller for MRP (Material Requirements Planning)
 */
const mrpController = {
    /**
     * Get global material requirements
     */
    getGlobalRequirements: async (req, res) => {
        try {
            const requirements = await mrpService.calculateGlobalRequirements();
            res.json(requirements);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * Get purchase recommendations
     */
    getPurchaseRecommendations: async (req, res) => {
        try {
            const recommendations = await mrpService.getPurchaseRecommendations();
            res.json(recommendations);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
};

module.exports = mrpController;
