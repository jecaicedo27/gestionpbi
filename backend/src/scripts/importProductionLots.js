/**
 * importProductionLots.js
 *
 * Imports all "YYYY FORMATOS PRODUCTO FINAL.xlsx" files from backend/tmp/
 * and upserts production lot records into the ProductionLot table.
 *
 * Usage:
 *   node src/scripts/importProductionLots.js
 *   node src/scripts/importProductionLots.js --file /abs/path/file.xlsx
 */
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');

const prisma = new PrismaClient();

// Excel flavor → DB flavor (normalized)
const FLAVOR_MAP = {
    'MARACUYA': 'Maracuya',
    'FRESA': 'Fresa',
    'CEREZA': 'Cereza',
    'CHAMOY': 'Chamoy',
    'CHICLE': 'Chicle',
    'COCO': 'Coco',
    'SANDIA': 'Sandia',
    'BLUEBERRY': 'Blueberry',
    'CAFE': 'Cafe',
    'LYCHE': 'Lyche',
    'ICE PINK': 'Ice pink',
    'MANGO BICHE': 'Mango biche',
    'MANGO CON SAL': 'Mango biche con sal',
    'MANZANA': 'Manzana verde',
    'MANZANA VERDE': 'Manzana verde',
};

function normalizeFlavor(raw) {
    const upper = String(raw || '').trim().toUpperCase();
    if (!upper) return null;
    return FLAVOR_MAP[upper] || upper.charAt(0) + upper.slice(1).toLowerCase();
}

function isPlausibleDate(date) {
    if (!date || isNaN(date.getTime())) return false;
    const year = date.getUTCFullYear();
    return year >= 2020 && year <= 2035;
}

function parseYYMMDD(value) {
    const s = String(value || '').replace(/\D/g, '');
    if (s.length !== 6) return null;
    const yy = parseInt(s.slice(0, 2), 10);
    const mm = parseInt(s.slice(2, 4), 10);
    const dd = parseInt(s.slice(4, 6), 10);
    if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const d = new Date(Date.UTC(2000 + yy, mm - 1, dd));
    return isPlausibleDate(d) ? d : null;
}

function parseDateFromLotCode(lotCode) {
    if (!lotCode) return null;
    const digits = String(lotCode).replace(/\D/g, '');
    if (digits.length < 6) return null;
    return parseYYMMDD(digits.slice(0, 6));
}

function excelDateToJS(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date && !isNaN(value.getTime())) {
        return isPlausibleDate(value) ? value : null;
    }
    if (typeof value === 'number') {
        // Typical Excel serial day range for current datasets
        if (value > 30000 && value < 70000) {
            const utcDays = Math.floor(value - 25569);
            const d = new Date(utcDays * 86400000);
            return isPlausibleDate(d) ? d : null;
        }
        // Sometimes dates come as YYMMDD numeric format
        const parsedYYMMDD = parseYYMMDD(Math.round(value));
        if (parsedYYMMDD) return parsedYYMMDD;
        return null;
    }
    const asText = String(value).trim();
    const parsedYYMMDD = parseYYMMDD(asText);
    if (parsedYYMMDD) return parsedYYMMDD;
    const parsed = new Date(asText);
    if (isNaN(parsed.getTime())) return null;
    return isPlausibleDate(parsed) ? parsed : null;
}

function safeFloat(val) {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    const normalized = String(val).replace(',', '.').trim();
    const n = parseFloat(normalized);
    return isNaN(n) ? null : n;
}

function safeInt(val) {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val);
    const n = parseInt(String(val).replace(/[^\d-]/g, ''), 10);
    return isNaN(n) ? null : n;
}

function safeText(val) {
    if (val === null || val === undefined || val === '') return null;
    const s = String(val).trim();
    return s || null;
}

function parseBooleanLike(val) {
    if (val === null || val === undefined || val === '') return null;
    const s = String(val).trim().toUpperCase();
    if (['SI', 'SÍ', 'YES', 'TRUE', '1', 'OK'].includes(s)) return true;
    if (['NO', 'FALSE', '0'].includes(s)) return false;
    return null;
}

function excelTimeToMinutes(val) {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number' && Number.isFinite(val)) {
        const fraction = val - Math.floor(val);
        return Math.round(fraction * 24 * 60);
    }
    const text = String(val).trim();
    const match = text.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return (h * 60) + m;
}

function combineDateWithMinutes(baseDate, minutes, dayOffset = 0) {
    if (!baseDate || !Number.isFinite(minutes)) return null;
    const d = new Date(baseDate);
    if (isNaN(d.getTime())) return null;
    const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + dayOffset, 0, 0, 0, 0);
    return new Date(utc + (minutes * 60000));
}

function parseDurationRawToMinutes(val) {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number' && Number.isFinite(val)) {
        if (val <= 1) return Math.round(val * 24 * 60); // Excel day fraction
        if (val <= 24) return Math.round(val * 60); // likely hours
        return Math.round(val); // likely minutes
    }
    const text = String(val).trim();
    const hhmm = text.match(/^(\d{1,2}):(\d{2})$/);
    if (hhmm) {
        return (parseInt(hhmm[1], 10) * 60) + parseInt(hhmm[2], 10);
    }
    const n = parseFloat(val);
    return isNaN(n) ? null : Math.round(n);
}

function buildDurationMinutes(startMin, endMin, rawDurationVal) {
    const rawMinutes = parseDurationRawToMinutes(rawDurationVal);
    if (Number.isFinite(rawMinutes) && rawMinutes > 0) return rawMinutes;
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return null;
    let diff = endMin - startMin;
    if (diff < 0) diff += 24 * 60; // wraps after midnight
    return diff >= 0 ? diff : null;
}

function findDataStartIndex(rows) {
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || [];
        const dateCandidate = row[0];
        const flavorCandidate = row[1];
        const lotCandidate = row[2];
        if (
            typeof dateCandidate === 'number' &&
            safeText(flavorCandidate) &&
            safeText(lotCandidate)
        ) {
            return i;
        }
    }
    return -1;
}

function resolveInputFiles() {
    const args = process.argv.slice(2);
    const fileArgIndex = args.findIndex(a => a === '--file');
    if (fileArgIndex >= 0 && args[fileArgIndex + 1]) {
        return [path.resolve(args[fileArgIndex + 1])];
    }

    const tmpDir = path.resolve(__dirname, '../../tmp');
    if (!fs.existsSync(tmpDir)) return [];
    return fs.readdirSync(tmpDir)
        .filter(f => /(FORMATOS PRODU.*\.xlsx|reporte_lotes.*\.xlsx)$/i.test(f))
        .map(f => path.join(tmpDir, f));
}

function resolveSheetName(sheetNames) {
    const target = sheetNames.find(name => /PROGRAMACION CUMPLIDA PERLAS/i.test(name));
    return target || null;
}

async function main() {
    const files = resolveInputFiles();

    if (files.length === 0) {
        console.error('No Excel files found. Use --file /ruta/archivo.xlsx or place files in backend/tmp/');
        process.exit(1);
    }

    console.log(`Found ${files.length} file(s):`, files);

    let totalImported = 0;
    let totalSkipped = 0;
    const byFlavor = {};
    const missingByField = {};

    const countMissing = (obj, fields) => {
        fields.forEach((field) => {
            if (obj[field] === null || obj[field] === undefined || obj[field] === '') {
                missingByField[field] = (missingByField[field] || 0) + 1;
            }
        });
    };

    for (const file of files) {
        const filePath = path.resolve(file);
        console.log(`\n📂 Processing: ${filePath}`);
        if (!fs.existsSync(filePath)) {
            console.warn(`  ⚠ File not found, skipping: ${filePath}`);
            continue;
        }

        const wb = XLSX.readFile(filePath);
        const sheetName = resolveSheetName(wb.SheetNames);
        const ws = sheetName ? wb.Sheets[sheetName] : null;
        if (!ws) {
            console.warn(`  ⚠ Sheet "PROGRAMACION CUMPLIDA PERLAS" not found in ${filePath}, skipping.`);
            continue;
        }

        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
        console.log(`  Rows: ${rows.length}`);
        const startIndex = findDataStartIndex(rows);
        if (startIndex < 0) {
            console.warn(`  ⚠ Could not locate first data row in ${filePath}, skipping.`);
            continue;
        }
        console.log(`  First data row: ${startIndex}`);

        for (let i = startIndex; i < rows.length; i++) {
            const row = rows[i];
            const flavorRaw = safeText(row[1]);
            const lotCode = safeText(row[2]);

            if (!flavorRaw || !lotCode) { totalSkipped++; continue; }

            const flavor = normalizeFlavor(flavorRaw);
            let productionDate = excelDateToJS(row[0]);
            if (!productionDate) {
                productionDate = parseDateFromLotCode(lotCode);
            }
            if (!productionDate) { totalSkipped++; continue; }

            const startMinutes = excelTimeToMinutes(row[12]);
            const endMinutes = excelTimeToMinutes(row[13]);
            const endDayOffset = (Number.isFinite(startMinutes) && Number.isFinite(endMinutes) && endMinutes < startMinutes) ? 1 : 0;

            const productionStartAt = combineDateWithMinutes(productionDate, startMinutes);
            const productionEndAt = combineDateWithMinutes(productionDate, endMinutes, endDayOffset);
            const productionDurationMin = buildDurationMinutes(startMinutes, endMinutes, row[14]);

            const pearlGrowthCheckRaw = safeText(row[22]);
            const premixLot = safeText(row[3]);
            const data = {
                lotCode, premixLot, flavor,
                flavorRaw: flavorRaw.toUpperCase(),
                productionDate,
                mixAssemblyNote: safeText(row[9]),
                mixQuantityKg: safeFloat(row[4]),
                phJarabe: safeFloat(row[5]),
                bxJarabe: safeFloat(row[6]),
                conductividad: safeFloat(row[7]),
                bxPerla: safeFloat(row[8]),
                tempCoccion: safeFloat(row[10]),
                tempChiller: safeFloat(row[11]),
                productionStartAt,
                productionEndAt,
                productionDurationMin,
                productionDurationRaw: safeText(row[14]),

                protectionLotCode: safeText(row[16]),
                protectionQuantityKg: safeFloat(row[17]),
                protectionPh: safeFloat(row[18]),
                protectionBx: safeFloat(row[19]),
                protectionAssemblyNote: safeText(row[20]),

                alginateLotCode: safeText(row[21]),
                pearlGrowthCheckRaw,
                pearlGrowthConfirmed: parseBooleanLike(pearlGrowthCheckRaw),
                pearlCookTempC: safeFloat(row[24]),
                pearlCookTimeSec: safeFloat(row[25]),

                protectionAdded3400: safeFloat(row[29]),
                protectionAdded1150: safeFloat(row[30]),
                protectionAdded350: safeFloat(row[31]),

                damaged3400: safeInt(row[32]),
                damaged1150: safeInt(row[33]),
                damaged350: safeInt(row[34]),

                pesoPerlas: safeFloat(row[23]),
                units3400: safeInt(row[26]),
                units1150: safeInt(row[27]), // 1100g in Excel -> 1150g in system
                units350: safeInt(row[28]), // 300g in Excel -> 350g in system
                logisticsDeliveredDate: excelDateToJS(row[35]),
                logisticsDeliveredTo: safeText(row[36]),
                leader: safeText(row[15]),
            };
            countMissing(data, [
                'mixQuantityKg',
                'phJarabe',
                'bxJarabe',
                'conductividad',
                'bxPerla',
                'tempCoccion',
                'tempChiller',
                'protectionLotCode',
                'protectionQuantityKg',
                'protectionPh',
                'protectionBx',
                'alginateLotCode',
                'pearlCookTempC',
                'pearlCookTimeSec',
                'units3400',
                'units1150',
                'units350',
                'damaged3400',
                'damaged1150',
                'damaged350'
            ]);

            try {
                await prisma.productionLot.upsert({
                    where: { lotCode },
                    create: data,
                    update: data,
                });
                totalImported++;
                byFlavor[flavor] = (byFlavor[flavor] || 0) + 1;
            } catch (err) {
                console.error(`  Row ${i}: error for lot "${lotCode}":`, err.message);
                totalSkipped++;
            }
        }
    }

    const dbTotal = await prisma.productionLot.count();
    console.log(`\n=== IMPORT RESULTS ===`);
    console.log(`Imported: ${totalImported}`);
    console.log(`Skipped:  ${totalSkipped}`);
    console.log(`Total lots in DB: ${dbTotal}`);
    console.log(`\nBy flavor:`);
    Object.entries(byFlavor).sort((a, b) => b[1] - a[1]).forEach(([f, c]) => {
        console.log(`  ${f}: ${c}`);
    });
    console.log(`\nMissing values by field (in processed rows):`);
    Object.entries(missingByField)
        .sort((a, b) => b[1] - a[1])
        .forEach(([field, count]) => console.log(`  ${field}: ${count}`));

    await prisma.$disconnect();
}

main().catch(err => {
    console.error('Fatal:', err);
    prisma.$disconnect();
    process.exit(1);
});
