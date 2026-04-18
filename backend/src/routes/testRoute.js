// Test endpoint - add to routes temporarily
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function getAlertLevel(product) {
    if (product.currentStock === 0) return 'CRITICO';
    if (product.daysOfStock === null || product.daysOfStock === undefined) return 'OK';
    if (product.daysOfStock < 3) return 'CRITICO';
    if (product.daysOfStock < 7) return 'ALERTA';
    return 'OK';
}

router.get('/test-inventory', async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            where: { active: true },
            include: {
                group: true,
                inventoryAlternate: true
            },
            orderBy: { name: 'asc' }
        });

        const inventory = products.map(p => {
            const reserved = p.inventoryAlternate?.reservedQty || 0;
            return {
                id: p.id,
                siigoId: p.siigoId,
                code: p.sku,
                name: p.name,
                barcode: p.barcode,
                type: p.type,
                group: p.group?.name || 'Otro',
                currentStock: p.currentStock,
                reserved,
                available: Math.max(0, p.currentStock - reserved),
                price: p.price,
                unit: p.unit,
                flavor: p.flavor,
                size: p.size,
                alertLevel: getAlertLevel(p)
            };
        });

        res.json({ success: true, data: inventory });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Temporary: test socket emit for purchase order alerts
router.get('/test-po-alert', (req, res) => {
    const io = req.app.get('io');
    if (!io) return res.json({ error: 'io not found on app' });
    io.emit('purchase_order:new', {
        orderNumber: 'OC-TEST-001',
        supplierName: 'TEST SUPPLIER',
        createdAt: new Date()
    });
    res.json({ success: true, message: 'Evento purchase_order:new emitido' });
});

module.exports = router;
