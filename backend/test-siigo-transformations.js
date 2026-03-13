const axios = require('axios');
require('dotenv').config();

async function testSiigoTransformations() {
    console.log('--- Siigo Transformations Test ---');

    try {
        // 1. Authenticate
        console.log('Authenticating...');
        const authResponse = await axios.post('https://api.siigo.com/auth', {
            username: process.env.SIIGO_USERNAME,
            access_key: process.env.SIIGO_ACCESS_KEY
        });
        const token = authResponse.data.access_token;
        console.log('Auth successful.');

        const client = axios.create({
            baseURL: 'https://api.siigo.com/v1',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Partner-Id': 'siigo'
            }
        });

        // 2. Fetch Transformations
        console.log('Fetching transformations...');
        const response = await client.get('/transformations?page=1&page_size=10');

        console.log('Response Status:', response.status);
        console.log('Results Count:', response.data.results ? response.data.results.length : 0);

        if (response.data.results && response.data.results.length > 0) {
            console.log('--- Last Transformation ---');
            console.log(JSON.stringify(response.data.results[0], null, 2));
        } else {
            console.log('No transformations found.');
        }

    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

testSiigoTransformations();
