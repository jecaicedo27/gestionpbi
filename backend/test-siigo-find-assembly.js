const axios = require('axios');
require('dotenv').config();

async function findAssemblyNoteEndpoints() {
    console.log('--- Probing Siigo for Assembly Notes ---');
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
            '/assembly-notes',
            '/manufacturing-transformations',
            '/production-notes',
            '/transformations', // Retrying just in case prefix was needed
            '/inventory/transformations'
        ];

        console.log('--- Probing Endpoints ---');
        for (const ep of endpoints) {
            try {
                const res = await client.get(`${ep}?page=1&page_size=1`);
                console.log(`Endpoint ${ep}: SUCCESS! Found ${res.data.results ? res.data.results.length : 'unknown'} items.`);
            } catch (err) {
                console.log(`Endpoint ${ep}: FAILED (${err.response ? err.response.status : err.message})`);
            }
        }

        console.log('\n--- Probing Document Types for NE ---');
        // NE is the code shown in the screenshot: NE-1-10586
        const types = ['NE', 'AN', 'MN', 'PR'];
        for (const t of types) {
            try {
                const res = await client.get(`/document-types?type=${t}`);
                console.log(`Type ${t}: SUCCESS! Found ${res.data.length} docs.`);
                res.data.forEach(d => console.log(`  - ${d.code}: ${d.name}`));
            } catch (err) {
                console.log(`Type ${t}: FAILED (${err.response ? err.response.status : err.message})`);
            }
        }

    } catch (error) {
        console.error('Error in probe:', error.message);
    }
}

findAssemblyNoteEndpoints();
