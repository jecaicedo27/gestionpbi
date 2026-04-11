const fs = require('fs');
const filepath = '/var/www/gestionpbi/frontend/src/components/GenialityRunner/steps/GConteoCarritosStep.jsx';
let content = fs.readFileSync(filepath, 'utf8');

const oldCode = `    const outputTargets = note?.productionBatch?.outputTargets || [];
    
    // Fallback if no outputTargets (unlikely for Geniality Siropes batch, but safe)
    if (outputTargets.length === 0) {`;

const newCode = `    let outputTargets = note?.productionBatch?.outputTargets || [];
    
    // Only show the target that matches the current note's product to avoid duplicate cards 
    // when clicking through multiple packaging steps in the same batch
    if (note?.processParameters?.product_id || note?.productId) {
        const targetId = note?.processParameters?.product_id || note?.productId;
        const matchingTarget = outputTargets.find(t => t.productId === targetId);
        if (matchingTarget) {
            outputTargets = [matchingTarget];
        }
    }
    
    // Fallback if no outputTargets (unlikely for Geniality Siropes batch, but safe)
    if (outputTargets.length === 0) {`;

content = content.replace(oldCode, newCode);
fs.writeFileSync(filepath, content, 'utf8');
console.log('Patched GConteoCarritosStep.jsx');
