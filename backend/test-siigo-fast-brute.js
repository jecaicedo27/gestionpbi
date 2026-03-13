const axios = require('axios');
require('dotenv').config();

async function fastBruteForce() {
    console.log('--- Fast Brute Force for Document Type ID 1673 ---');
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

        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const codes = [];
        for (let i = 0; i < alphabet.length; i++) {
            for (let j = 0; j < alphabet.length; j++) {
                codes.push(alphabet[i] + alphabet[j]);
            }
        }

        const batchSize = 20;
        for (let i = 0; i < codes.length; i += batchSize) {
            const batch = codes.slice(i, i + batchSize);
            const results = await Promise.all(batch.map(async (code) => {
                try {
                    const res = await client.get(`/document-types?type=${code}`, { timeout: 3000 });
                    return { code, docs: res.data };
                } catch (err) {
                    return { code, docs: [] };
                }
            }));

            for (const r of results) {
                if (r.docs.length > 0) {
                    console.log(`Code ${r.code}: Found ${r.docs.length} docs.`);
                    r.docs.forEach(d => {
                        if (d.id === 1673 || d.id === '1673' || d.name.toLowerCase().includes('ensamble')) {
                            console.log(`!!! MATCH FOUND !!! Code ${r.code} -> ${d.name} (ID: ${d.id})`);
                        }
                    });
                }
            }
        }

    } catch (error) {
        console.error('Fast brute force failed:', error.message);
    }
}

fastBruteForce();
