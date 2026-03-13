const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger');

const siigoService = require('../services/siigoService');

const handleSiigoWebhook = async (req, res) => {
    try {
        const event = req.body;
        logger.info(`Webhook received: ${JSON.stringify(event)}`);

        // Typical Siigo Webhook payload (based on APIARY docs)
        // { "event": "product.updated", "id": "GUID", ... }
        // Or sometimes it's wrapped. We'll check for 'id' or 'resource_id'.

        // Check for 'resources' array (Siigo format found in logs)
        const resourceId = event.id ||
            (event.data && event.data.id) ||
            (event.resource && event.resource.id) ||
            (event.resources && event.resources[0] && event.resources[0].id);

        if (resourceId) {
            logger.info(`Syncing product from webhook: ${resourceId}`);

            try {
                // 1. Fetch fresh data from Siigo
                const productData = await siigoService.getProduct(resourceId);

                // 2. Sync to local DB
                if (productData) {
                    await siigoService.syncProduct(productData);
                    logger.info(`✅ Product ${resourceId} synced successfully via webhook.`);
                }
            } catch (syncError) {
                // Determine if it's a 404 (product not found in Siigo anymore?)
                logger.error(`Failed to sync product ${resourceId} from webhook:`, syncError.message);
                // We should still return 200 OK to Siigo so they don't retry indefinitely if it's a logical error on our side
            }
        } else {
            logger.warn('Webhook received but no valid Resource ID found in payload.');
        }

        const io = req.app.get('io');
        if (io) {
            // Broadest possible emit
            io.emit('siigo:event', event);
            // Also emit generic update to refresh dashboards
            io.emit('inventory:updated', { productId: resourceId, timestamp: new Date() });
        }

        res.status(200).send('OK');
    } catch (error) {
        logger.error('CRITICAL Webhook Error:', error);
        // Return 200 to prevent Siigo from disabling the webhook due to errors
        res.status(200).send('Webhook received with internal error');
    }
};

module.exports = { handleSiigoWebhook };
