const axios = require('axios');
require('dotenv').config();

async function listSiigoDocumentTypes() {
    console.log('--- Siigo Document Types Test ---');
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

        console.log('Fetching document types...');
        const response = await client.get('/document-types?type=TR'); // TR is often used for transformations
        console.log('Response for type=TR:', response.data);

        const allResponse = await client.get('/document-types');
        console.log('All available types:', allResponse.data.map(d => `${d.code} - ${d.name}`));

    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

listSiigoDocumentTypes();
