const axios = require('axios');
require('dotenv').config();

async function deepProbe() {
    console.log('--- Deep Probe for NE-1-10586 ---');
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

        const endpoints = [
            '/vouchers',
            '/journals',
            '/invoices',
            '/credit-notes',
            '/purchases',
            '/fixed-assets'
        ];

        console.log('Searching for document number 10586 in various modules...');
        for (const ep of endpoints) {
            try {
                // Siigo API usually supports filtering by number or document prefix
                // Try number 10586
                const res = await client.get(`${ep}?number=10586`);
                if (res.data.results && res.data.results.length > 0) {
                    console.log(`FOUND in ${ep}:`, JSON.stringify(res.data.results[0], null, 2));
                } else {
                    console.log(`Not found in ${ep} with number 10586`);
                }
            } catch (err) {
                // console.log(`Error in ${ep}:`, err.message);
            }
        }

        console.log('\nTrying direct ID fetch for 509152 (from URL)...');
        const candidatePaths = [
            '/assembly-notes',
            '/transformations',
            '/journals',
            '/vouchers',
            '/invoices'
        ];
        for (const p of candidatePaths) {
            try {
                const res = await client.get(`${p}/509152`);
                console.log(`ID 509152 FOUND at ${p}!`);
                console.log(JSON.stringify(res.data, null, 2));
                break;
            } catch (err) {
                // console.log(`ID 509152 NOT at ${p}`);
            }
        }

        console.log('\nProbing for document types with "NE" prefix...');
        // Some APIs use different codes for types
        const probeTypes = ['NE', 'NI', 'AI', 'AN', 'TR', 'TC', 'TN', 'TE'];
        for (const t of probeTypes) {
            try {
                const res = await client.get(`/document-types?type=${t}`);
                if (res.data && res.data.length > 0) {
                    console.log(`Type ${t} is valid and found:`, res.data.map(d => d.name));
                }
            } catch (err) { }
        }

    } catch (error) {
        console.error('Terminal Error:', error.message);
    }
}

deepProbe();
