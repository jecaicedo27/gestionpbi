const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const hc = require('../controllers/shiftHandoverController');

// Current handover for area
router.get('/current',          auth, hc.getCurrent);

// History
router.get('/history',          auth, hc.getHistory);

// Checklist templates
router.get('/checklists',       auth, hc.getChecklists);
router.put('/checklists',       auth, hc.updateChecklists);

// Alarm & block
router.get('/alarm-status',     auth, hc.alarmStatus);
router.get('/block-status',     auth, hc.blockStatus);

// PIN verification
router.post('/verify-pin',      auth, hc.verifyPin);

// Detail & signatures
router.get('/:id',              auth, hc.getDetail);
router.get('/:id/signatures',   auth, hc.getSignatures);

// Operator signs
router.post('/:id/sign',               auth, hc.signOperator);

// Outgoing leader authorizes
router.post('/:id/authorize-outgoing',  auth, hc.authorizeOutgoing);

// Incoming leader accepts
router.post('/:id/accept-incoming',     auth, hc.acceptIncoming);

// Supervisor validates (optional)
router.post('/:id/validate',            auth, hc.validateHandover);

// Flag incident
router.post('/:id/flag-incident',       auth, hc.flagIncident);

// Admin force-complete
router.post('/:id/force-complete',      auth, hc.forceComplete);

module.exports = router;
