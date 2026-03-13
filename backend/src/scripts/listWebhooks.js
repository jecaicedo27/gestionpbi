const siigoService = require('../services/siigoService');
const logger = require('../utils/logger');

async function checkWebhooks() {
    try {
        console.log('Authenticating...');
        await siigoService.authenticate();

        console.log('Fetching Webhooks...');
        // Try GET /webhooks to list them
        const response = await siigoService.request('/webhooks', { method: 'GET' });

        console.log('Current Webhooks:', JSON.stringify(response, null, 2));

        if (response && response.results) {
            const myWebhook = response.results.find(w => w.url.includes('gestionpbi.lat'));
            if (myWebhook) {
                console.log(`Found Webhook ID: ${myWebhook.id}, Status: ${myWebhook.active}`);

                // If inactive, try to update it
                if (!myWebhook.active) {
                    console.log('Webhook is INACTIVE. Attempting to re-activate...');
                    await siigoService.request(`/webhooks/${myWebhook.id}`, {
                        method: 'PUT',
                        data: {
                            application_id: myWebhook.application_id,
                            topic: myWebhook.topic,
                            url: myWebhook.url,
                            active: true
                        }
                    });
                    console.log('✅ Webhook re-activated successfully!');
                }
            }
        }

    } catch (error) {
        console.error('Error checking webhooks:', error.message);
        if (error.response) console.error('Data:', error.response.data);
    }
}

checkWebhooks();
