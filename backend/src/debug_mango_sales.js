const XLSX = require('xlsx');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function parseSize(name) {
    name = name.toUpperCase();
    if (name.includes('3400') || name.includes('3.4') || name.includes('GALON')) return { value: 3400, unit: 'GR', kgFactor: 3.4 };
    if (name.includes('1150') || name.includes('1.15') || name.includes('LITRO')) return { value: 1150, unit: 'GR', kgFactor: 1.15 };
    if (name.includes('350') || name.includes('350GR')) return { value: 350, unit: 'GR', kgFactor: 0.35 };
    return { value: 0, unit: 'NA', kgFactor: 0 };
}

async function main() {
    // 1. Fetch Mango Products
    const products = await prisma.product.findMany({
        where: {
            name: { contains: 'MANGO BICHE' },
            classification: 'PRODUCTO_TERMINADO',
            active: true
        }
    });

    console.log("Mango Products:", products.map(p => p.sku + ' - ' + p.name));

    // 2. Read Excel
    const filePath = path.join(__dirname, '../Movimiento 2025.xlsx');
    console.log("Reading:", filePath);
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    let totalKg = 0;

    data.forEach(row => {
        const code = row['Código producto'];
        const product = products.find(p => p.sku === code);

        if (product) {
            const sizeInfo = parseSize(product.name).then(s => s).catch(() => ({ kgFactor: 0 })); // Async wrapper mock
        }
    });

    // Re-implement sync loop for simplicity (parseSize is sync in real code? checked: it wasn't shown but likely sync).
    // Let's assume sync for the script logic or copy regex.

    // Actually the real parseSize function in controller is not imported. I'll copy the logic.
    const _parseSize = (name) => {
        name = name.toUpperCase();
        if (name.includes('3400') || name.includes('3.4')) return 3.4;
        if (name.includes('1150') || name.includes('1.15')) return 1.15;
        if (name.includes('350')) return 0.35;
        return 0;
    }

    data.forEach(row => {
        const code = row['Código producto'];
        const product = products.find(p => p.sku === code);

        if (product) {
            const kgFactor = _parseSize(product.name);
            const qty = row['Cantidad salida'] || 0;
            const kg = qty * kgFactor;
            totalKg += kg;
            // console.log(`Sold ${qty} of ${product.name} = ${kg}kg`);
        }
    });

    console.log("--------------------------------");
    console.log(`Total Annual Sales (Kg): ${totalKg.toFixed(2)}`);
    console.log(`Daily Consumption (Total / 365): ${(totalKg / 365).toFixed(2)} kg/day`);

    // Simulate Logic
    const daily = totalKg / 365;
    const target8 = daily * 8;
    console.log(`Target 8 Days: ${target8.toFixed(2)} kg`);

    // Calculate Stock
    let currentStockKg = 0;
    products.forEach(p => {
        currentStockKg += (p.currentStock * _parseSize(p.name));
    });
    console.log(`Current Stock (Kg): ${currentStockKg.toFixed(2)} kg`);

    const deficit = target8 - currentStockKg;
    console.log(`Deficit (Target - Stock): ${deficit.toFixed(2)} kg`);

    const rounded = Math.ceil(Math.max(1, deficit) / 120) * 120;
    console.log(`Suggestion (Rounded 120): ${rounded} kg`);

}

main();
