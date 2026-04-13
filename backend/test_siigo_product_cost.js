require('dotenv').config();
const s = require('./src/services/siigoService');

(async () => {
    try {
        await s.authenticate();
        // Look up LIQD05
        const res = await s.client.get('/products?code=LIQD05');
        console.log(JSON.stringify(res.data, null, 2));
    } catch(e) {
        console.error("error:", e.message, JSON.stringify(e.response?.data, null, 2));
    }
})();
