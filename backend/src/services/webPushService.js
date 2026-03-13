/**
 * webPushService.js — Manages Web Push subscriptions and sends
 * push notifications to all registered browser clients.
 *
 * Subscriptions are stored in-memory (Map keyed by endpoint).
 * On backend restart, clients re-subscribe automatically on page load.
 */
const webpush = require('web-push');
const logger = require('../utils/logger');

// ── VAPID Configuration ──
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@gestionpbi.lat';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    logger.info('🔔 Web Push: VAPID configured');
} else {
    logger.warn('🔔 Web Push: VAPID keys missing in .env — push disabled');
}

// ── In-memory subscription store ──
const subscriptions = new Map(); // endpoint → subscription object

/**
 * Save a push subscription from a client.
 */
function saveSubscription(subscription) {
    if (!subscription?.endpoint) return false;
    subscriptions.set(subscription.endpoint, subscription);
    logger.info(`🔔 Push subscription saved (${subscriptions.size} total)`);
    return true;
}

/**
 * Remove a push subscription.
 */
function removeSubscription(endpoint) {
    const removed = subscriptions.delete(endpoint);
    if (removed) logger.info(`🔔 Push subscription removed (${subscriptions.size} total)`);
    return removed;
}

/**
 * Send a push notification to ALL registered subscriptions.
 * @param {Object} payload - { title, body, icon, tag, data }
 */
async function sendPushToAll(payload) {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
    if (subscriptions.size === 0) return;

    const payloadStr = JSON.stringify(payload);
    const stale = [];

    const promises = Array.from(subscriptions.entries()).map(async ([endpoint, sub]) => {
        try {
            await webpush.sendNotification(sub, payloadStr);
        } catch (err) {
            if (err.statusCode === 410 || err.statusCode === 404) {
                // Subscription expired or invalid
                stale.push(endpoint);
            } else {
                logger.error(`🔔 Push send error: ${err.statusCode || err.message}`);
            }
        }
    });

    await Promise.allSettled(promises);

    // Clean up stale subscriptions
    for (const ep of stale) {
        subscriptions.delete(ep);
    }

    if (stale.length > 0) {
        logger.info(`🔔 Removed ${stale.length} stale push subscriptions`);
    }
}

/**
 * Get the VAPID public key (needed by frontend to subscribe).
 */
function getPublicKey() {
    return VAPID_PUBLIC || null;
}

module.exports = { saveSubscription, removeSubscription, sendPushToAll, getPublicKey };
