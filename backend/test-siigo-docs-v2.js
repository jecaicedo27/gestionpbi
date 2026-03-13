const axios = require('axios');
require('dotenv').config();

async function listAllSiigoDocumentTypes() {
    console.log('--- Listing All Siigo Document Types ---');
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

        const response = await client.get('/document-types');
        const docs = response.data;

        console.log(`Found ${docs.length} document types.`);

        const relevantDocs = docs.filter(d =>
            d.name.toLowerCase().includes('ensamble') ||
            d.name.toLowerCase().includes('transform') ||
            d.name.toLowerCase().includes('manufact') ||
            d.name.toLowerCase().includes('produc')
        );

        console.log('--- Relevant Document Types ---');
        console.log(relevantDocs.map(d => `${d.code} - ${d.name} (ID: ${d.id})`));

        console.log('--- Sample of all types ---');
        console.log(docs.slice(0, 10).map(d => `${d.code} - ${d.name}`));

    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

listAllSiigoDocumentTypes();
