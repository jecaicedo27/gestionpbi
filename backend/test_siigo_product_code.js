require('dotenv').config();
const s = require('./src/services/siigoService');

(async () => {
    try {
        await s.authenticate();
        // Look up LIQA07
        const res = await s.client.get('/products?code=LIQA07');
        console.log(JSON.stringify(res.data.results[0] || {}, null, 2));
    } catch(e) {
        console.error("error:", e.message);
    }
})();
