const XLSX = require('xlsx');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    // 1. Get DB Products for Liquipops
    const products = await prisma.product.findMany({
        where: {
            group: { name: 'LIQUIPOPS' },
            classification: 'PRODUCTO_TERMINADO',
            active: true
        },
        select: { sku: true, name: true, flavor: true }
    });

    console.log(`Found ${products.length} Liquipops products in DB.`);

    // Filter for Chamoy
    const chamoyDB = products.filter(p => p.flavor && p.flavor.toUpperCase().includes('CHAMOY'));
    console.log("--- Chamoy Products in DB ---");
    chamoyDB.forEach(p => console.log(`${p.sku} | ${p.name} | Flavor field: ${p.flavor}`));

    // 2. Read Excel
    const filePath = path.join(__dirname, '../../Movimiento 2025.xlsx'); // Adjusted path based on controller
    console.log(`\nReading Excel from: ${filePath}`);

    let workbook;
    try {
        workbook = XLSX.readFile(filePath);
    } catch (e) {
        console.error("Excel file not found or unreadable:", e.message);
        return;
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);
    console.log(`Loaded ${data.length} rows from Excel.`);

    // 3. Search for Chamoy in Excel
    console.log("\n--- Chamoy Entries in Excel (By Name/Code Matches) ---");
    let foundMatches = 0;

    // Search for COCO by NAME in the Excel file
    console.log("\n--- Searching Excel for 'COCO' by Name ---");
    const cocoRows = data.filter(r => r['Nombre producto'] && r['Nombre producto'].toUpperCase().includes('COCO'));

    // Aggregate by Code
    const foundCodes = {};
    cocoRows.forEach(r => {
        const code = r['Código producto'];
        if (!foundCodes[code]) foundCodes[code] = { name: r['Nombre producto'], sales: 0 };
        foundCodes[code].sales += (r['Cantidad salida'] || 0);
    });

    console.table(foundCodes);

    /*
    // Check specific SKUs for COCO
    const cocoDB = products.filter(p => p.flavor && p.flavor.toUpperCase().includes('COCO'));
    console.log("--- Coco Products in DB ---");
    cocoDB.forEach(p => {
        const row = data.find(r => r['Código producto'] === p.sku);
        const sales = row ? row['Cantidad salida'] : 'undefined';
        console.log(`SKU: ${p.sku} | Stock: ${p.currentStock} | Sales: ${sales}`);
    });
    */

    if (foundMatches === 0) {
        console.log("WARNING: Zero matches found using Exact SKU.");
        console.log("Dumping first 5 rows of Excel to check headers:");
        console.log(JSON.stringify(data.slice(0, 5), null, 2));
    }
}

check();
