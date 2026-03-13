const axios = require('axios');
require('dotenv').config();

async function pollJournals() {
    console.log('--- Polling Recent Journals for Type 1673 ---');
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

        const res = await client.get('/journals?page=1&page_size=100');
        const journals = res.data.results;

        const typeSet = new Set();
        for (const j of journals) {
            typeSet.add(j.document.id);
            if (j.document.id === 1673 || j.document.id === '1673') {
                console.log('!!! FOUND JOURNAL WITH TYPE 1673 !!!');
                console.log(JSON.stringify(j, null, 2));
                return;
            }
        }

        console.log('Unique Document IDs found in recent journals:', Array.from(typeSet));

    } catch (error) {
        console.error('Error:', error.message);
    }
}

pollJournals();
