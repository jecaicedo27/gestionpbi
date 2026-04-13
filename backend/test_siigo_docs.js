require('dotenv').config();
const s = require('./src/services/siigoService');

(async () => {
    try {
        await s.authenticate();
        for (const type of ['CC', 'Journal', 'Inventory', 'AJ', 'AJI', 'NI']) {
            try {
                const res = await s.client.get(`/document-types?type=${type}`);
                console.log(`Type ${type}:`, JSON.stringify(res.data, null, 2));
            } catch(e) {
                console.log(`Type ${type} failed.`);
            }
        }
    } catch(e) {
        console.error(e.message, e.response?.data);
    }
})();
