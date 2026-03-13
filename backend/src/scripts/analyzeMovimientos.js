const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '../../Movimiento.xlsx');
const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

// Indexes from previous run
// 'Código producto' [0], 'Nombre producto' [1], 'Comprobante' [2], 'Fecha elaboración' [3], 'Cantidad entrada' [4], 'Cantidad salida' [5]
const COL_NAME = 1;
const COL_DOC = 2;
const COL_ENTRY = 4;
const COL_EXIT = 5;

let neEntryCount = 0;
let neExitCount = 0;
let fvExitCount = 0;
let fcEntryCount = 0;

const neEntryExamples = new Set();
const neExitExamples = new Set();
const fvExitExamples = new Set();

// Skip header
for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const doc = (row[COL_DOC] || '').toString().toUpperCase();
    const qtyIn = parseFloat(row[COL_ENTRY]) || 0;
    const qtyOut = parseFloat(row[COL_EXIT]) || 0;
    const name = row[COL_NAME];

    if (doc.startsWith('NE')) {
        if (qtyIn > 0) {
            neEntryCount++;
            if (neEntryExamples.size < 5) neEntryExamples.add(name);
        }
        if (qtyOut > 0) {
            neExitCount++;
            if (neExitExamples.size < 5) neExitExamples.add(name);
        }
    } else if (doc.startsWith('FV')) {
        if (qtyOut > 0) {
            fvExitCount++;
            if (fvExitExamples.size < 5) fvExitExamples.add(name);
        }
    } else if (doc.startsWith('FC')) {
        if (qtyIn > 0) {
            fcEntryCount++;
        }
    }
}

console.log('--- Stats ---');
console.log(`NE Lines (Entry - Production/Purchase): ${neEntryCount}`);
console.log('Examples:', Array.from(neEntryExamples));

console.log(`\nNE Lines (Exit - Consumption?): ${neExitCount}`);
console.log('Examples:', Array.from(neExitExamples));

console.log(`\nFV Lines (Sales): ${fvExitCount}`);
console.log('Examples:', Array.from(fvExitExamples));

console.log(`\nFC Lines (Purchase): ${fcEntryCount}`);

if (neExitCount === 0) {
    console.log('\nWARNING: No raw material consumption (NE Exits) found. We might need to infer consumption from recipes.');
}
