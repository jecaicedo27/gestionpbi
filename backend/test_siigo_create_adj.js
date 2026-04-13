require('dotenv').config();
const s = require('./src/services/siigoService');

(async () => {
    try {
        await s.authenticate();
        const res = await s.client.post('/invoices', { // wait, invoices decreases stock but uses sale prices
            date: "2026-04-12"
        }).catch(()=>null);
        
        const res2 = await s.client.post('/documents', { 
            type: 'Inventory',
            document: { id: 98 },
            date: "2026-04-12",
            items: []
        }).catch(e => e.response?.data);
        console.log("Documents endpoint:", JSON.stringify(res2, null, 2));

    } catch(e) {
        console.error("error:", e.message);
    }
})();
