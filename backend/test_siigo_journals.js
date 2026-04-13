require('dotenv').config();
const s = require('./src/services/siigoService');

(async () => {
    try {
        await s.authenticate();
        // 1. Get document types for Journal
        const res = await s.client.get('/document-types?type=Journal');
        console.log("Journal Document Types:", JSON.stringify(res.data, null, 2));

        // 2. Get Account groups to see inventory codes ?
        const accountsRes = await s.client.get('/account-groups');
        console.log("\nAccount Groups:");
        console.log(JSON.stringify(accountsRes.data.slice(0, 3) || {}, null, 2));
    } catch(e) {
        console.error(e.message, e.response?.data);
    }
})();
