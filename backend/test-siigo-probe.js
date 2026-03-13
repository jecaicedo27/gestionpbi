const axios = require('axios');
require('dotenv').config();

async function probeSiigoTypes() {
    console.log('--- Probing Siigo Document Types ---');
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

        const typesToTry = ['FV', 'NC', 'ND', 'RC', 'CC', 'AJ', 'NI', 'G', 'TR'];

        for (const type of typesToTry) {
            try {
                const response = await client.get(`/document-types?type=${type}`);
                console.log(`Type ${type}: SUCCESS. Found ${response.data.length} docs.`);
                if (response.data.length > 0) {
                    console.log(`Example for ${type}: ${response.data[0].code} - ${response.data[0].name}`);
                }
            } catch (err) {
                console.log(`Type ${type}: FAILED (${err.response ? err.response.status : err.message})`);
            }
        }

    } catch (error) {
        console.error('Error in probe:', error.message);
    }
}

probeSiigoTypes();
