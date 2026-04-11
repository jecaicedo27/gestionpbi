const fs = require('fs');
const filepath = '/var/www/gestionpbi/frontend/src/components/GenialityRunner/GenialityExecutionWizard.jsx';
let content = fs.readFileSync(filepath, 'utf8');

// Fix polling effect
const oldPolling = `        if (currentStep?.type !== 'EMPAQUE' && !isPackaging) return;`;
const newPolling = `        if (!['EMPAQUE', 'G_CONTEO_CARRITOS', 'MARCADO_CAJAS'].includes(currentStep?.type) && !isPackaging) return;`;
content = content.replace(oldPolling, newPolling);

// Fix props passage
const oldProps = `                    carriots={['OPERARIO_PICKING', 'EMPAQUE'].includes(user?.role) || wizardSteps[currentStepIndex]?.type === 'EMPAQUE' || wizardSteps[currentStepIndex]?.type === 'CARRITOS_RECEPTION'
                        ? empaqueCarriots
                        : carriots}`;
const newProps = `                    carriots={['OPERARIO_PICKING', 'EMPAQUE'].includes(user?.role) || ['EMPAQUE', 'CARRITOS_RECEPTION', 'G_CONTEO_CARRITOS', 'MARCADO_CAJAS'].includes(wizardSteps[currentStepIndex]?.type)
                        ? empaqueCarriots
                        : carriots}`;
content = content.replace(oldProps, newProps);

// Wait, I should also restore my GConteoCarritosStep.jsx changes!
const gConteoFilepath = '/var/www/gestionpbi/frontend/src/components/GenialityRunner/steps/GConteoCarritosStep.jsx';
let gContent = fs.readFileSync(gConteoFilepath, 'utf8');
const oldGCode = `    const outputTargets = note?.productionBatch?.outputTargets || [];
    
    // Fallback if no outputTargets (unlikely for Geniality Siropes batch, but safe)
    if (outputTargets.length === 0) {`;
const newGCode = `    let outputTargets = note?.productionBatch?.outputTargets || [];
    
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
gContent = gContent.replace(oldGCode, newGCode);
fs.writeFileSync(gConteoFilepath, gContent, 'utf8');

fs.writeFileSync(filepath, content, 'utf8');
console.log('Patched GenialityExecutionWizard and GConteoCarritosStep');
