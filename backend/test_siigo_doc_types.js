require('dotenv').config();
const SiigoService = require('./src/services/siigoService');

(async () => {
    try {
        const s = new SiigoService();
        await s.authenticate();
        const res = await s.client.get('/document-types?type=Journal');
        console.log(JSON.stringify(res.data, null, 2));
    } catch(e) {
        console.error(e.message, e.response?.data);
    }
})();
