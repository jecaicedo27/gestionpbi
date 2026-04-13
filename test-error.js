const fs = require('fs');
const js = fs.readFileSync('/var/www/gestionpbi/frontend/dist/assets/index-DMZQ_W5k.js', 'utf8');
const lines = js.split('\n');
console.log(lines[1690].substring(22700, 22800));
