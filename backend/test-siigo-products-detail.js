const axios = require('axios');
require('dotenv').config();

async function checkProductDetails() {
    console.log('--- Checking Product Details for Manufacturing ---');
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

        // Fetch first 5 products
        const response = await client.get('/products?page=1&page_size=5');
        const products = response.data.results;

        for (const p of products) {
            console.log(`Product: ${p.name} (ID: ${p.id}, Code: ${p.code})`);
            // Look for fields like "type", "manufactured", "components", "bom"
            console.log('Keys:', Object.keys(p));
            if (p.type) console.log('Type:', p.type);
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkProductDetails();
