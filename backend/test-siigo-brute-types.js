const axios = require('axios');
require('dotenv').config();

async function bruteForceTypes() {
    console.log('--- Brute Forcing Siigo Document Types (A-Z, A-Z) ---');
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
        const batches = [];

        // Prepare list of all 2-letter codes
        const codes = [];
        for (let i = 0; i < alphabet.length; i++) {
            for (let j = 0; j < alphabet.length; j++) {
                codes.push(alphabet[i] + alphabet[j]);
            }
        }

        // Try in batches to avoid overwhelming (or just loop with small delay)
        console.log(`Starting probe for ${codes.length} codes...`);

        for (let i = 0; i < codes.length; i++) {
            const t = codes[i];
            try {
                // Use a short timeout to speed up failure cases
                const res = await client.get(`/document-types?type=${t}`, { timeout: 2000 });
                if (res.data && res.data.length > 0) {
                    console.log(`Type "${t}": Success! Found types:`, res.data.map(d => `${d.name} (ID: ${d.id})`));
                    // Check if 1673 is here
                    if (res.data.some(d => d.id === 1673 || d.id === '1673')) {
                        console.log(`!!! FOUND THE TYPE !!! Code ${t} has ID 1673.`);
                    }
                }
            } catch (err) {
                // console.log(`Type "${t}": FAILED`);
            }
            // Small pause every 10 requests
            if (i % 10 === 0) await new Promise(r => setTimeout(r, 100));
        }

    } catch (error) {
        console.error('Brute force failed:', error.message);
    }
}

bruteForceTypes();
