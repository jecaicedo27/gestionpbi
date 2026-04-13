require('dotenv').config();
const s = require('./src/services/siigoService');

(async () => {
    try {
        await s.authenticate();
        const res = await s.client.post('/journals', {
            document: { id: 9335 }, // Ajustes contables 1
            date: "2026-04-12",
            items: [
                {
                    account: { code: "14050501", movement: "Credit" }, // WRONG ACCOUNT! Materia Prima instead of Prod Term
                    customer: { identification: "901878434" },
                    product: { code: "LIQA07", quantity: 1 }, 
                    value: 12088.42
                },
                {
                    account: { code: "71050504", movement: "Debit" },
                    customer: { identification: "901878434" },
                    value: 12088.42
                }
            ]
        });
        console.log("Success:", JSON.stringify(res.data, null, 2));
    } catch(e) {
        console.error("error:", e.message, JSON.stringify(e.response?.data, null, 2));
    }
})();
