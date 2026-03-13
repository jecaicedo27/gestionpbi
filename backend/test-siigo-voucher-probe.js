const axios = require('axios');
require('dotenv').config();

async function probeVouchersByDocId() {
    console.log('--- Probing Vouchers by Document ID 1673 ---');
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

        // Try document_id parameter (common in Siigo API for filtering by type id)
        try {
            const res = await client.get('/vouchers?document_id=1673&page=1&page_size=10');
            console.log('SUCCESS! Found vouchers with document_id=1673:');
            console.log(JSON.stringify(res.data, null, 2));
        } catch (err) {
            console.log('Failed with document_id=1673:', err.response ? err.response.status : err.message);
        }

        // Try document parameter (some versions use this)
        try {
            const res2 = await client.get('/vouchers?document=1673&page=1&page_size=10');
            console.log('SUCCESS! Found vouchers with document=1673:');
            console.log(JSON.stringify(res2.data, null, 2));
        } catch (err) { }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

probeVouchersByDocId();
