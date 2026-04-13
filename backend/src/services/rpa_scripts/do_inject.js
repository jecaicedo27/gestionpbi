const fs = require('fs');
let mgr = fs.readFileSync('backend/src/services/siigoBrowserManager.js', 'utf8');
const snippet = fs.readFileSync('backend/src/services/rpa_scripts/adjustment_raw.js', 'utf8');
if (!mgr.includes('async executeInventoryAdjustment')) {
    mgr = mgr.replace(/(\/\*\*[^*]+getStatus \(\) {)/, snippet + '\n    $1');
    fs.writeFileSync('backend/src/services/siigoBrowserManager.js', mgr);
    console.log('Injected successfully');
} else {
    console.log('Already injected function body');
}
