const axios = require('axios');
require('dotenv').config();

async function versionProbe() {
    console.log('--- Versioned API Probe ---');
    try {
        const authResponse = await axios.post('https://api.siigo.com/auth', {
            username: process.env.SIIGO_USERNAME,
            access_key: process.env.SIIGO_ACCESS_KEY
        });
        const token = authResponse.data.access_token;

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Partner-Id': 'siigo'
        };

        const urls = [
            'https://api.siigo.com/v1.0/transformations',
            'https://api.siigo.com/v1.1/transformations',
            'https://api.siigo.com/v1/inventory/transformations',
            'https://api.siigo.com/v1/manufacturing/transformations',
            'https://api.siigo.com/v1/assembly-notes',
            'https://api.siigo.com/v1.0/assembly-notes'
        ];

        for (const u of urls) {
            try {
                const res = await axios.get(u + '?page=1', { headers });
                console.log(`URL ${u}: SUCCESS!`);
                console.log(JSON.stringify(res.data, null, 2));
                return;
            } catch (err) {
                console.log(`URL ${u}: FAILED (${err.response ? err.response.status : err.message})`);
            }
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

versionProbe();
