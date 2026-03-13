const axios = require('axios');
require('dotenv').config();

async function probeById() {
    console.log('--- Probing Siigo by ID 509152 ---');
    try {
        const authResponse = await axios.post('https://api.siigo.com/auth', {
            username: process.env.SIIGO_USERNAME,
            access_key: process.env.SIIGO_ACCESS_KEY
        });
        const token = authResponse.data.access_token;

        const client = axios.create({
            baseURL: 'https://api.siigo.com/v1',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Partner-Id': 'siigo'
            }
        });

        const id = '509152';
        const endpoints = [
            '/transformations',
            '/assembly-notes',
            '/vouchers',
            '/journals',
            '/invoices',
            '/credit-notes',
            '/purchases',
            '/inventory-notes',
            '/stock-movements',
            '/manufacturing',
            '/production'
        ];

        for (const ep of endpoints) {
            try {
                // Try direct ID
                const res = await client.get(`${ep}/${id}`);
                console.log(`!!! SUCCESS !!! ID ${id} found at ${ep}`);
                console.log(JSON.stringify(res.data, null, 2));
                return;
            } catch (err) {
                // console.log(`ID ${id} not at ${ep} (${err.response ? err.response.status : err.message})`);
            }
        }

        console.log('ID 509152 not found in any common endpoint.');

    } catch (error) {
        console.error('Error:', error.message);
    }
}

probeById();
