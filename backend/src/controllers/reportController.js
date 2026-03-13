
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const XLSX = require('xlsx');

// Helper to round to pack size
const roundToPack = (val, pack) => {
    const p = pack || 1;
    return Math.ceil(val / p) * p;
};

// Generate Production Report (Product Finished)
exports.generateProductionReport = async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 8; // Default 8 days

        // Fetch all active Finished Products
        const products = await prisma.product.findMany({
            where: {
                classification: 'PRODUCTO_TERMINADO',
                active: true
            },
            orderBy: [
                { group: { name: 'asc' } },
                { flavor: 'asc' },
                { name: 'asc' }
            ],
            include: {
                group: true
            }
        });

        // Prepare Data for Excel
        const data = products.map(p => {
            const velocity = p.dailyVelocity || 0;
            const stock = p.currentStock || 0;
            const pack = p.packSize || 1;

            const needed = velocity * days;
            const deficit = Math.max(0, needed - stock);

            const suggestedUnits = roundToPack(deficit, pack);
            const suggestedPacks = suggestedUnits / pack;

            return {
                'Grupo': p.group?.name || 'Sin Grupo',
                'Producto': p.name,
                'Código': p.code,
                'Stock Actual': stock,
                'Velocidad Diaria': Number(velocity.toFixed(2)),
                'Días a Cubrir': days,
                'Requerido (Unidades)': Math.ceil(needed),
                'Déficit': Math.ceil(deficit),
                'Pack Size': pack,
                'A Producir (Unidades)': suggestedUnits,
                'A Producir (Packs)': suggestedPacks
            };
        }).filter(item => item['A Producir (Unidades)'] > 0);

        // Create Workbook
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);

        // Adjust column widths
        const wscols = [
            { wch: 20 }, // Grupo
            { wch: 40 }, // Producto
            { wch: 10 }, // Codigo
            { wch: 12 }, // Stock
            { wch: 15 }, // Velocidad
            { wch: 12 }, // Dias
            { wch: 15 }, // Requerido
            { wch: 10 }, // Deficit
            { wch: 10 }, // Pack
            { wch: 20 }, // A Producir Units
            { wch: 15 }  // A Producir Packs
        ];
        ws['!cols'] = wscols;

        XLSX.utils.book_append_sheet(wb, ws, "Produccion");

        // Write to buffer
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', `attachment; filename="Plan_Produccion_${days}dias.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (error) {
        console.error('Error generating production report:', error);
        res.status(500).json({ error: 'Error generating report' });
    }
};

// Generate Purchasing Report (Raw Material & Packaging)
exports.generatePurchasingReport = async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 15; // Default 15 days

        // Fetch Raw Material and Packaging
        const products = await prisma.product.findMany({
            where: {
                classification: 'MATERIA_PRIMA',
                active: true
            },
            orderBy: [
                { group: { name: 'asc' } },
                { flavor: 'asc' },
                { name: 'asc' }
            ],
            include: {
                group: true
            }
        });

        const data = products.map(p => {
            const velocity = p.dailyVelocity || 0;
            const stock = p.currentStock || 0;
            const pack = p.packSize || 1;

            const needed = velocity * days;
            const deficit = Math.max(0, needed - stock);

            const suggestedUnits = roundToPack(deficit, pack);
            const suggestedPacks = suggestedUnits / pack;

            return {
                'Tipo': p.classification,
                'Grupo': p.group?.name || 'Sin Grupo',
                'Producto': p.name,
                'Código': p.code,
                'Stock Actual': stock,
                'Velocidad Diaria': Number(velocity.toFixed(2)),
                'Días a Cubrir': days,
                'Requerido (Unidades)': Math.ceil(needed),
                'Déficit': Math.ceil(deficit),
                'Presentación (Pack)': pack,
                'A Comprar (Unidades)': suggestedUnits,
                'A Comprar (Bultos)': suggestedPacks
            };
        }).filter(item => item['A Comprar (Unidades)'] > 0);

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);

        const wscols = [
            { wch: 15 }, // Tipo
            { wch: 20 }, // Grupo
            { wch: 40 }, // Producto
            { wch: 10 }, // Codigo
            { wch: 12 }, // Stock
            { wch: 15 }, // Velocidad
            { wch: 12 }, // Dias
            { wch: 15 }, // Requerido
            { wch: 10 }, // Deficit
            { wch: 15 }, // Pack
            { wch: 20 }, // A Comprar Units
            { wch: 15 }  // A Comprar Packs
        ];
        ws['!cols'] = wscols;

        XLSX.utils.book_append_sheet(wb, ws, "Compras");

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Disposition', `attachment; filename="Plan_Compras_${days}dias.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (error) {
        console.error('Error generating purchasing report:', error);
        res.status(500).json({ error: 'Error generating report' });
    }
};
