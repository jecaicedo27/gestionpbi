const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/printController');
const { auth } = require('../middleware/auth');

// Solo accesible para rol DISENO y ADMIN
const allowDesignOrAdmin = (req, res, next) => {
    const role = req.user?.role;
    if (role === 'DISENO' || role === 'ADMIN') return next();
    return res.status(403).json({ error: 'Permisos insuficientes — requiere rol DISEÑO o ADMIN' });
};

router.get('/labels', auth, allowDesignOrAdmin, ctrl.listLabels);
router.post('/register', auth, allowDesignOrAdmin, ctrl.register);
router.get('/history', auth, allowDesignOrAdmin, ctrl.history);

module.exports = router;
