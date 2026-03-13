const axios = require('axios');
require('dotenv').config();

async function discoverEndpoints() {
    console.log('--- API Endpoint Discovery ---');
    try {
        const authResponse = await axios.post('https://api.siigo.com/auth', {
            username: process.env.SIIGO_USERNAME,
            access_key: process.env.SIIGO_ACCESS_KEY
        });
        const token = authResponse.data.access_token;

        const client = axios.create({
            baseURL: 'https://api.siigo.com/v1', // Standard
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Partner-Id': 'siigo'
            }
        });

        const paths = [
            '/transformations',
            '/assembly-notes',
            '/production-notes',
            '/manufacturing-notes',
            '/inventory-movements',
            '/vouchers/manufacturing',
            '/vouchers/assembly',
            '/transformations/document-types',
            '/manufacturing/document-types'
        ];

        for (const p of paths) {
            try {
                await client.get(p + '?page=1');
                console.log(`Endpoint ${p}: VALID (200)`);
            } catch (err) {
                if (err.response && err.response.status !== 404) {
                    console.log(`Endpoint ${p}: RESPONSE ${err.response.status}`);
                }
            }
        }

        // Try v1.0
        try {
            await axios.get('https://api.siigo.com/v1.0/products', { headers: { 'Authorization': `Bearer ${token}` } });
            console.log('v1.0 is a valid prefix.');
        } catch (err) { }

    } catch (error) {
        console.error('Discovery Error:', error.message);
    }
}

discoverEndpoints();
