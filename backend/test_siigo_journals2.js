require('dotenv').config();
const s = require('./src/services/siigoService');

(async () => {
    try {
        await s.authenticate();
        const res = await s.client.get('/journals?page=1&page_size=5');
        console.log("Journals:", JSON.stringify(res.data, null, 2));
    } catch(e) {
        console.error("Journals error:", e.message, e.response?.data);
    }
})();
