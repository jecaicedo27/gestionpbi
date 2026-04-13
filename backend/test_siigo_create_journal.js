require('dotenv').config();
const s = require('./src/services/siigoService');

(async () => {
    try {
        await s.authenticate();
        const res = await s.client.post('/journals', {
            document: { id: 29623 }, // AJT
            date: "2026-04-12",
            items: [
                {
                    account: { code: "14050502", movement: "Credit" },
                    customer: { identification: "901878434" },
                    product: { code: "LIQD05", quantity: 1 },
                    value: 0 // <--- test with 0
                },
                {
                    account: { code: "71050503", movement: "Debit" },
                    customer: { identification: "901878434" },
                    value: 0
                }
            ]
        });
        console.log("Success:", JSON.stringify(res.data, null, 2));
    } catch(e) {
        console.error("error:", e.message, JSON.stringify(e.response?.data, null, 2));
    }
})();
