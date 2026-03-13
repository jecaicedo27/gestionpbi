const browserManager = require('../services/siigoBrowserManager');
async function run() {
    console.log('Testing RPA...');
    browserManager.enqueue({
        params: {
            productName: "PROCELIQUIPOPS49",
            quantity: 1,
            assemblyType: "Producto en proceso - producto terminado",
            observations: "Test diagnostic"
        },
        executionId: 'test-123',
        resolve: (r) => { console.log('✅ SUCCESS:', r); process.exit(0); },
        reject: (e) => { console.error('❌ REJECTED:', e.message); process.exit(1); }
    });
}
run();
// Keep alive
setInterval(() => { }, 1000);
