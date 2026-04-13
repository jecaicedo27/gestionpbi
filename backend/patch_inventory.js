const fs = require('fs');
const file = '/var/www/gestionpbi/backend/src/controllers/inventoryController.js';
let data = fs.readFileSync(file, 'utf8');

const oldFunc = `exports.getProductsSimple = async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            where: { active: true },
            select: {
                id: true,
                sku: true,
                name: true,
                unit: true,
                currentStock: true,
                classification: true,
                type: true,
                flavor: true,
                group: {
                    select: { name: true }
                }
            },
            orderBy: { name: 'asc' }
        });
        res.json(products);
    } catch (error) {
        logger.error('Error in getProductsSimple:', error);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
};`;

const newFunc = `exports.getProductsSimple = async (req, res) => {
    try {
        const { search } = req.query;
        let whereClause = { active: true };
        if (search) {
            whereClause.name = { contains: search, mode: 'insensitive' };
        }
        const products = await prisma.product.findMany({
            where: whereClause,
            select: {
                id: true,
                sku: true,
                name: true,
                unit: true,
                currentStock: true,
                productionZoneStock: true,
                classification: true,
                type: true,
                flavor: true,
                group: {
                    select: { name: true }
                }
            },
            orderBy: { name: 'asc' }
        });
        res.json(products);
    } catch (error) {
        logger.error('Error in getProductsSimple:', error);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
};`;

if (data.includes(oldFunc)) {
    fs.writeFileSync(file, data.replace(oldFunc, newFunc), 'utf8');
    console.log('patched');
} else {
    console.log('could not find function text exactly');
}
