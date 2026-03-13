const axios = require('axios');
require('dotenv').config();

async function exhaustiveProbe() {
    console.log('--- Exhaustive Probe for Assembly Types ---');
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

        const keywords = [
            'Transformation', 'Transformations', 'Assembly', 'AssemblyNote',
            'Manufacturing', 'Note', 'Inventory', 'InventoryNote', 'Adjustment',
            'Stock', 'Movement', 'Production', 'Manufactura', 'Ensamble', 'Transformacion'
        ];

        for (const k of keywords) {
            try {
                const res = await client.get(`/document-types?type=${k}`);
                console.log(`Keyword "${k}": SUCCESS! Found ${res.data.length} types.`);
                res.data.forEach(d => console.log(`  -> ${d.code}: ${d.name} (ID: ${d.id})`));
            } catch (err) {
                // console.log(`Keyword "${k}": FAILED (${err.response ? err.response.status : err.message})`);
            }
        }

        // Try to fetch specific NE documents if possible
        // Maybe the endpoint is /v1/assembly-notes/ne-1-10586? 
        const variants = ['NE-1-10586', '10586', 'NE110586'];
        const paths = ['/assembly-notes', '/transformations', '/journals', '/invoices'];
        for (const p of paths) {
            for (const v of variants) {
                try {
                    const res = await client.get(`${p}/${v}`);
                    console.log(`Found ${v} at ${p}!`);
                } catch (err) { }
            }
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

exhaustiveProbe();
