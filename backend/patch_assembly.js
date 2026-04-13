const fs = require('fs');
const file = '/var/www/gestionpbi/backend/src/services/assemblyService.js';
let data = fs.readFileSync(file, 'utf8');

const regex = /if \(Math\.abs\(cached - realSum\) > 1\) \{\s*console\.log\(`\[zoneStock\].*?`\);\s*await tx\.product\.update\(\{\s*where: \{ id: productId \},\s*data: \{ productionZoneStock: realSum \}\s*\}\);\s*\}/;

const replaceWith = `if (Math.abs(cached - realSum) > 1) {
        const drift = realSum - cached;
        console.log(\`[zoneStock] 🔄 Auto-reconcile productId=\${productId.slice(0,8)}: cached=\${cached}g → real=\${realSum}g (drift=\${drift}g)\`);
        await tx.product.update({
            where: { id: productId },
            data: { productionZoneStock: realSum }
        });
        
        await tx.auditLog.create({
            data: {
                action: 'AUTO_RECONCILE',
                entity: 'PRODUCTION_ZONE_STOCK',
                entityId: productId,
                changes: {
                    previousStock: cached,
                    newStock: realSum,
                    drift: drift,
                    reason: 'Drift detected between MaterialLot sum and productionZoneStock cache'
                }
            }
        });
    }`;
    
if (regex.test(data)) {
    fs.writeFileSync(file, data.replace(regex, replaceWith), 'utf8');
    console.log('assemblyService patched');
} else {
    console.log('Regex not found in assemblyService.js');
}
