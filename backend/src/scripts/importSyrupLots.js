/**
 * importSyrupLots.js
 *
 * Imports syrup production data from "2026 Y 2025 SIROPE GENIALITY.xlsx"
 * into the SyrupLot table.
 *
 * Usage:  node src/scripts/importSyrupLots.js
 */
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');

const prisma = new PrismaClient();

// Flavor normalization map (handles typos from Excel)
const FLAVOR_MAP = {
    'MARACUYA': 'Maracuya',
    'MARCUYA': 'Maracuya',
    'FRESA': 'Fresa',
    'CEREZA': 'Cereza',
    'CHICLE': 'Chicle',
    'CURAZAO': 'Curazao',
    'ESCARCHADOR': 'Escarchador',
    'ESCARCADOR': 'Escarchador',
    'BLUEBERRY': 'Blueberry',
    'SANDIA': 'Sandia',
    'MANGO BICHE': 'Mango biche',
    'MANZANA': 'Manzana verde',
    'MANZANA VERDE': 'Manzana verde',
    'LYCHE': 'Lyche',
    'LYCHE0': 'Lyche',
    'TAMARINDO': 'Tamarindo',
    'GRANADINA': 'Granadina',
    'LIQUIMON': 'Liquimon',
    'ZUMO LIMON': 'Zumo limon',
};

function normalizeFlavor(raw) {
    const upper = String(raw).trim().toUpperCase();
    return FLAVOR_MAP[upper] || upper.charAt(0) + upper.slice(1).toLowerCase();
}

function excelDateToJS(serial) {
    if (!serial || typeof serial !== 'number') return null;
    const utcDays = Math.floor(serial - 25569);
    const d = new Date(utcDays * 86400000);
    // Sanity check: skip dates before 2020 or after 2030
    if (d.getFullYear() < 2020 || d.getFullYear() > 2030) return null;
    return d;
}

function safeFloat(val) {
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
}

function safeInt(val) {
    const n = parseInt(val, 10);
    return isNaN(n) ? 0 : n;
}

async function main() {
    const filePath = path.resolve(__dirname, '../../tmp/2026 Y 2025 SIROPE GENIALITY.xlsx');

    if (!fs.existsSync(filePath)) {
        console.error('File not found:', filePath);
        process.exit(1);
    }

    console.log(`📂 Reading: ${path.basename(filePath)}`);

    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets['PROGRAMACION CUMPLIDA SIROPES'];
    if (!ws) {
        console.error('Sheet "PROGRAMACION CUMPLIDA SIROPES" not found');
        process.exit(1);
    }

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    console.log(`  Total rows (including header): ${rows.length}`);

    // Headers (row 0):
    // 0: fecha, 1: sabor, 2: lote, 3: cantidad kg, 4: pH, 5: Bx
    // 6: nota ensamble, 7: 1000ML, 8: 360ML, 9: 60ML
    // 10: delivered 1000, 11: delivered 360, 12: delivered 60
    // 13: delivery date, 14: leader, 15: (unused)

    let totalImported = 0;
    let totalSkipped = 0;
    const byFlavor = {};

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const flavorRaw = row[1] ? String(row[1]).trim() : null;
        const lotCode = row[2] ? String(row[2]).trim() : null;

        if (!flavorRaw || !lotCode) { totalSkipped++; continue; }

        const flavor = normalizeFlavor(flavorRaw);
        const productionDate = excelDateToJS(row[0]);
        if (!productionDate) { totalSkipped++; continue; }

        const deliveryDate = excelDateToJS(row[13]);

        const data = {
            lotCode,
            flavor,
            flavorRaw: flavorRaw.toUpperCase(),
            productionDate,
            mixQuantityKg: safeFloat(row[3]),
            phJarabe: safeFloat(row[4]),
            bxJarabe: safeFloat(row[5]),
            assemblyNote: row[6] ? String(row[6]).trim() : null,
            units1000ml: safeInt(row[7]),
            units360ml: safeInt(row[8]),
            units60ml: safeInt(row[9]),
            delivered1000ml: safeInt(row[10]),
            delivered360ml: safeInt(row[11]),
            delivered60ml: safeInt(row[12]),
            deliveryDate,
            leader: row[14] ? String(row[14]).trim() : null,
        };

        try {
            await prisma.syrupLot.upsert({
                where: {
                    lotCode_flavor_productionDate: {
                        lotCode: data.lotCode,
                        flavor: data.flavor,
                        productionDate: data.productionDate,
                    }
                },
                create: data,
                update: data,
            });
            totalImported++;
            byFlavor[flavor] = (byFlavor[flavor] || 0) + 1;
        } catch (err) {
            console.error(`  Row ${i}: error for lot "${lotCode}" flavor "${flavor}":`, err.message);
            totalSkipped++;
        }
    }

    const dbTotal = await prisma.syrupLot.count();
    console.log(`\n=== IMPORT RESULTS ===`);
    console.log(`Imported: ${totalImported}`);
    console.log(`Skipped:  ${totalSkipped}`);
    console.log(`Total syrup lots in DB: ${dbTotal}`);
    console.log(`\nBy flavor:`);
    Object.entries(byFlavor).sort((a, b) => b[1] - a[1]).forEach(([f, c]) => {
        console.log(`  ${f}: ${c}`);
    });

    await prisma.$disconnect();
}

main().catch(err => {
    console.error('Fatal:', err);
    prisma.$disconnect();
    process.exit(1);
});
