const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth').auth;
const c = require('../controllers/inventoryCountController');

router.get('/sessions',                     auth, c.getSessions);
router.post('/sessions',                    auth, c.createSession);
router.get('/sessions/:id',                 auth, c.getSession);
router.put('/sessions/:id/close',           auth, c.closeSession);
router.delete('/sessions/:id',              auth, c.deleteSession);
router.post('/sessions/:id/lines',          auth, c.upsertLine);
router.delete('/lines/:lineId',             auth, c.deleteLine);
router.get('/sessions/:id/report',          auth, c.getReport);

module.exports = router;
