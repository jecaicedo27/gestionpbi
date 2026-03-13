const XLSX = require('xlsx');
const wb = XLSX.readFile('/var/www/gestionpbi/backend/tmp/2025 FORMATOS PRODUCTO FINAL.xlsx');
console.log('Sheet names:', JSON.stringify(wb.SheetNames));
wb.SheetNames.forEach(name => {
    const ws = wb.Sheets[name];
    const ref = ws['!ref'] || 'A1';
    const range = XLSX.utils.decode_range(ref);
    console.log(`\n=== Sheet: '${name}' === Range: ${ref}, Rows: ${range.e.r + 1}, Cols: ${range.e.c + 1}`);
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    data.slice(0, 3).forEach((row, i) => console.log(`Row ${i}:`, JSON.stringify(row.slice(0, 15))));
});
