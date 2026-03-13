const siigoService = require('../services/siigoService');
const logger = require('../utils/logger');

async function registerWebhook() {
    try {
        console.log('Authenticating with Siigo...');
        await siigoService.authenticate();

        const webhookPayload = {
            "application_id": "GestionPBI", // Name of our app
            "topic": "public.siigoapi.products.update", // Event to listen to
            "url": "https://gestionpbi.lat/api/webhooks/siigo" // Our receiving URL
        };

        console.log('Registering Webhook:', webhookPayload);

        // Assuming the endpoint is /webhooks based on standard API usage, 
        // user screenshot doesn't show the endpoint URL path but implies it exists.
        // We will try POST /webhooks
        // Note: Some docs say /v1/webhooks

        // We use the generic request method from the service
        // The service adds /v1 prefix automatically? Let's check siigoService.js
        // Yes: url: `${this.baseURL}/v1${endpoint}`

        // So we just pass /webhooks
        const response = await siigoService.request('/webhooks', {
            method: 'POST',
            data: webhookPayload
        });

        console.log('✅ Webhook Registered Successfully!');
        console.log('Response:', JSON.stringify(response, null, 2));

    } catch (error) {
        console.error('❌ Error registering webhook:', error.message);
        if (error.response) {
            console.error('Siigo API Response:', error.response.data);
        }
    }
}

registerWebhook();
