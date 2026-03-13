const axios = require('axios');
require('dotenv').config();

async function targetedBrute() {
    console.log('--- Targeted Brute Force for "Ensamble" Document Type ---');
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

        const prefixes = ['A', 'E', 'N', 'P', 'S', 'T'];
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        const codes = [];
        for (const p of prefixes) {
            for (let j = 0; j < alphabet.length; j++) {
                codes.push(p + alphabet[j]);
            }
        }

        console.log(`Probing ${codes.length} codes...`);

        for (const t of codes) {
            try {
                const res = await client.get(`/document-types?type=${t}`);
                if (res.data && res.data.length > 0) {
                    const match = res.data.find(d =>
                        d.name.toLowerCase().includes('ensamble') ||
                        d.name.toLowerCase().includes('transform') ||
                        d.id === 1673 || d.id === '1673'
                    );
                    if (match) {
                        console.log(`!!! MATCH FOUND !!! Code ${t} -> ${match.name} (ID: ${match.id})`);
                    } else {
                        // console.log(`Type ${t}: ${res.data.length} docs, none matching "Ensamble".`);
                    }
                }
            } catch (err) { }
        }

        console.log('Probe finished.');

    } catch (error) {
        console.error('Error:', error.message);
    }
}

targetedBrute();
