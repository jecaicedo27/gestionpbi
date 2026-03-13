const axios = require('axios');
require('dotenv').config();

async function findByDate() {
    console.log('--- Searching Siigo Journals by Date (2026-01-08) ---');
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

        // 1. Search journals by date
        console.log('Fetching journals for 2026-01-08...');
        const res = await client.get('/journals?date_start=2026-01-08&date_end=2026-01-08&page_size=50');

        if (res.data.results && res.data.results.length > 0) {
            console.log(`Found ${res.data.results.length} journals on that day.`);
            for (const j of res.data.results) {
                console.log(`- Document: ${j.document?.id}, Number: ${j.number}, Obs: ${j.observations?.substring(0, 50)}`);
                if (j.number === 10586 || j.observations?.toLowerCase().includes('ensamble')) {
                    console.log('!!! POSSIBLE MATCH !!!');
                    console.log(JSON.stringify(j, null, 2));
                }
            }
        } else {
            console.log('No journals found for that date.');
        }

        // 2. Try to find the document type with ID 1673 (from URL)
        console.log('\nTrying to identify document type ID 1673...');
        const typesToProbe = ['FV', 'NC', 'ND', 'RC', 'CC', 'FC', 'NI', 'AI', 'TR', 'AN', 'NE'];
        for (const t of typesToProbe) {
            try {
                const typesRes = await client.get(`/document-types?type=${t}`);
                const match = typesRes.data.find(d => d.id === 1673 || d.id === '1673');
                if (match) {
                    console.log(`!!! MATCH FOUND !!! Type ${t} has ID 1673: ${match.name}`);
                }
            } catch (err) { }
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

findByDate();
