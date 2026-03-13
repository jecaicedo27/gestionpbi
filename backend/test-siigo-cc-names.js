const axios = require('axios');
require('dotenv').config();

async function listCCDocNames() {
    console.log('--- Listing Siigo CC Document Names ---');
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

        const response = await client.get('/document-types?type=CC');
        const docs = response.data;

        console.log(`Found ${docs.length} CC types.`);
        docs.forEach(d => {
            console.log(`${d.code} - ${d.name} (ID: ${d.id})`);
        });

    } catch (error) {
        console.error('Error:', error.message);
    }
}

listCCDocNames();
