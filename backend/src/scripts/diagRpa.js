const browserManager = require('../services/siigoBrowserManager');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = path.join(__dirname, '..', 'rpa-screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

(async () => {
    try {
        console.log('=== TEST: Login + Company + Navigate ===');
        console.log('Starting initialize...');
        await browserManager.initialize();
        console.log('✅ initialize() succeeded!');
        console.log('URL:', browserManager.page?.url()?.substring(0, 80));
        console.log('isReady:', browserManager.isReady);
        
        // Screenshot of where we ended up
        if (browserManager.page) {
            await browserManager.page.screenshot({ 
                path: path.join(SHOT_DIR, 'diag-final-success.png'), 
                fullPage: true 
            });
            console.log('Screenshot saved: diag-final-success.png');
        }
        
        await browserManager.cleanup();
        console.log('DONE ✅');
        process.exit(0);
    } catch (e) {
        console.error('❌ FAILED:', e.message);
        
        // Try to capture screenshot of failure state
        if (browserManager.page) {
            try {
                await browserManager.page.screenshot({ 
                    path: path.join(SHOT_DIR, 'diag-final-error.png'), 
                    fullPage: true 
                });
                console.log('Error screenshot saved: diag-final-error.png');
            } catch (se) { /* ignore */ }
        }
        
        // Print logs
        console.log('\n=== LOGS ===');
        browserManager.logs.forEach(l => console.log(l));
        
        await browserManager.cleanup();
        process.exit(1);
    }
})();
