const axios = require('axios');
require('dotenv').config();

async function getRecentDocs() {
    console.log('--- Fetching Recent Siigo Documents ---');
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

        // 1. Try to fetch recent Journals (CC)
        console.log('Checking recent Journals (CC)...');
        const journals = await client.get('/journals?page=1&page_size=5');
        if (journals.data.results && journals.data.results.length > 0) {
            console.log('Last Journal:', journals.data.results[0].document.code, journals.data.results[0].document.number);
            console.log('Observations:', journals.data.results[0].observations);
        }

        // 2. Try to fetch recent Invoices (FV)
        console.log('Checking recent Invoices (FV)...');
        const invoices = await client.get('/invoices?page=1&page_size=5');
        if (invoices.data.results && invoices.data.results.length > 0) {
            console.log('Last Invoice:', invoices.data.results[0].document.code, invoices.data.results[0].document.number);
        }

    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

getRecentDocs();
