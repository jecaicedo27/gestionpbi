/**
 * Push Subscription routes — save/remove browser push subscriptions.
 */
const express = require('express');
const router = express.Router();
const { saveSubscription, removeSubscription, getPublicKey } = require('../services/webPushService');

// GET /api/push/vapid-key — return the VAPID public key for frontend subscription
router.get('/vapid-key', (req, res) => {
    const key = getPublicKey();
    if (!key) return res.status(503).json({ error: 'Push not configured' });
    res.json({ publicKey: key });
});

// POST /api/push/subscribe — save a push subscription
router.post('/subscribe', (req, res) => {
    const subscription = req.body;
    if (!subscription?.endpoint) {
        return res.status(400).json({ error: 'Invalid subscription: missing endpoint' });
    }
    saveSubscription(subscription);
    res.json({ success: true });
});

// POST /api/push/unsubscribe — remove a push subscription
router.post('/unsubscribe', (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint) {
        return res.status(400).json({ error: 'Missing endpoint' });
    }
    removeSubscription(endpoint);
    res.json({ success: true });
});

module.exports = router;
