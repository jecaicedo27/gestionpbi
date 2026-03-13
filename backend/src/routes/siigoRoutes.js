const express = require('express');
const router = express.Router();
const siigoService = require('../services/siigoService');
const { auth, roles } = require('../middleware/auth');

router.post('/sync/products', auth, roles(['ADMIN', 'LOGISTICA']), async (req, res) => {
    try {
        const io = req.app.get('io');
        const result = await siigoService.syncAllProducts(io);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error sincronizando productos con SIIGO' });
    }
});

module.exports = router;
