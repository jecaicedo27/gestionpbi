require('dotenv').config();
const s = require('./src/services/siigoService');

(async () => {
    try {
        await s.authenticate();
        // Check if there is an endpoint for document-types?type=Inventory or check anything containing inventory
        const res = await s.client.get('/document-types');
        const invDocs = res.data.filter(d => d.name.toLowerCase().includes('inventario') || d.description?.toLowerCase().includes('inventario'));
        console.log("Inventory Docs:", JSON.stringify(invDocs, null, 2));

    } catch(e) {
        console.error("error:", e.message, JSON.stringify(e.response?.data, null, 2));
    }
})();
