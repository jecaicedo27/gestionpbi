require('dotenv').config();
const s = require('./src/services/siigoService');

(async () => {
    try {
        await s.authenticate();
        const res = await s.client.get('/document-types');
        const d = res.data.find(x => x.id === 1107 || x.id === '1107');
        if (d) console.log(JSON.stringify(d, null, 2));
        else console.log("Did not find 1107 via general lookup.");
    } catch(e) {
        console.error("error");
    }
})();
