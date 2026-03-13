const axios = require('axios');
const XLSX = require('xlsx');

const API_URL = 'http://localhost:3051/api';

async function verifyProductionFilter() {
    try {
        console.log('1. Logging in...');
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            email: 'admin@poppingbobainternational.com',
            password: 'admin123'
        });

        const token = loginRes.data.token;
        console.log('Login successful.');

        console.log('2. Requesting Production Report...');
        const reportRes = await axios.get(`${API_URL}/reports/production?days=15`, {
            headers: { Authorization: `Bearer ${token}` },
            responseType: 'arraybuffer'
        });

        if (reportRes.status === 200) {
            console.log('✅ Production Report received.');
            const workbook = XLSX.read(reportRes.data, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(sheet);

            console.log(`Total Rows: ${data.length}`);

            const zeros = data.filter(r => r['A Producir (Unidades)'] === 0);
            if (zeros.length === 0) {
                console.log('✅ PASS: No items with 0 production units found.');
            } else {
                console.error(`❌ FAIL: Found ${zeros.length} items with 0 units.`);
                console.log(zeros.slice(0, 3));
            }
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

verifyProductionFilter();
