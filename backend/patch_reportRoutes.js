const fs = require('fs');
const file = '/var/www/gestionpbi/backend/src/routes/reportRoutes.js';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes('kardexController')) {
    const header = `const reportController = require('../controllers/reportController');\nconst kardexController = require('../controllers/kardexController');`;
    content = content.replace("const reportController = require('../controllers/reportController');", header);
    
    const routeDef = `router.get('/production', auth, reportController.generateProductionReport);
router.get('/kardex/production-zone/:productId', auth, kardexController.getProductionZoneKardex);`;
    content = content.replace("router.get('/production', auth, reportController.generateProductionReport);", routeDef);
    
    fs.writeFileSync(file, content, 'utf8');
    console.log('reportRoutes.js successfully updated.');
} else {
    console.log('reportRoutes.js already updated.');
}
