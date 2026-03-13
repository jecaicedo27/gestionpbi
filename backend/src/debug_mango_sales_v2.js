const XLSX = require('xlsx');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const _parseSize = (name) => {
    name = name.toUpperCase();
    if (name.includes('3400') || name.includes('3.4') || name.includes('GALON')) return 3.4;
    if (name.includes('1150') || name.includes('1.15') || name.includes('LITRO')) return 1.15;
    if (name.includes('350') || name.includes('350GR')) return 0.35;
    return 0;
};

async function main() {
    // 1. Fetch Products matching Controller Logic
    // Controller: group.name = 'LIQUIPOPS', classification: 'PRODUCTO_TERMINADO'
    const products = await prisma.product.findMany({
        where: {
            group: { name: 'LIQUIPOPS' },
            classification: 'PRODUCTO_TERMINADO',
            active: true
        }
    });

    // Filter for Flavor: "Mango biche con sal"
    const mangoProducts = products.filter(p => p.flavor && p.flavor.toUpperCase() === 'MANGO BICHE CON SAL');

    console.log("Matched Products:", mangoProducts.map(p => `${p.sku} (${p.currentStock} units)`));

    // 2. Read Excel
    const filePath = path.join(__dirname, '../Movimiento 2025.xlsx');
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    let totalKg = 0;

    data.forEach(row => {
        const code = row['Código producto'];
        // Find if this row belongs to one of our filtered products
        const product = mangoProducts.find(p => p.sku === code);

        if (product) {
            const kgFactor = _parseSize(product.name);
            const qty = row['Cantidad salida'] || 0;
            const kg = qty * kgFactor;
            totalKg += kg;
        }
    });

    const daily = totalKg / 365;

    // Calculate Stock
    let currentStockKg = 0;
    mangoProducts.forEach(p => {
        currentStockKg += (p.currentStock * _parseSize(p.name));
    });

    console.log("--------------------------------");
    console.log(`Flavor: MANGO BICHE CON SAL`);
    console.log(`Annual Sales: ${totalKg.toFixed(1)} kg`);
    console.log(`Daily Consumption: ${daily.toFixed(1)} kg/day`);
    console.log(`Current Stock: ${currentStockKg.toFixed(1)} kg`);

    // Scenario A: 12 Days (Old)
    const target12 = daily * 12;
    const def12 = target12 - currentStockKg;
    const sugg12 = Math.ceil(Math.max(1, def12) / 120) * 120;
    console.log(`12-Day Rule: Needs ${def12.toFixed(1)}kg -> Suggests ${sugg12}kg`);

    // Scenario B: 8 Days (New)
    const target8 = daily * 8;
    const def8 = target8 - currentStockKg;
    const sugg8 = Math.ceil(Math.max(1, def8) / 120) * 120;
    console.log(`8-Day Rule: Needs ${def8.toFixed(1)}kg -> Suggests ${sugg8}kg`);
}

main();
