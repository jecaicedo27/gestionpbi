const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '../../Movimiento 2025.xlsx');
console.log(`Reading: ${filePath}`);

const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];

// Get headers (first row)
const headers = [];
const range = XLSX.utils.decode_range(sheet['!ref']);
for (let C = range.s.c; C <= range.e.c; ++C) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: C })];
    if (cell && cell.v) headers.push(cell.v);
}

console.log("Headers found:", headers);

// Dump first row of data
const data = XLSX.utils.sheet_to_json(sheet);
if (data.length > 0) {
    console.log("First row keys:", Object.keys(data[0]));
}
