const { execSync } = require('child_process');
const original = execSync('git show HEAD~3:frontend/src/components/GenialityRunner/steps/GConteoCarritosStep.jsx').toString();
console.log(original.match(/zpl.*=/g));
