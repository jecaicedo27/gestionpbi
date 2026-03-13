const axios = require('axios');
require('dotenv').config();

async function probeByConsecutive() {
    console.log('--- Probing by consecutive 10586 ---');
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

        const endpoints = ['/vouchers', '/invoices', '/credit-notes', '/purchases'];
        for (const ep of endpoints) {
            try {
                const res = await client.get(`${ep}?consecutive=10586`);
                if (res.data.results && res.data.results.length > 0) {
                    console.log(`FOUND in ${ep} with consecutive 10586:`, res.data.results[0].name);
                }
            } catch (err) { }
        }

        console.log('Finished probing by consecutive.');

    } catch (error) {
        console.error('Error:', error.message);
    }
}

probeByConsecutive();
