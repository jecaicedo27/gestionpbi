const XLSX = require('xlsx');
const path = require('path');

async function inspectExcel() {
    const filePath = '/var/www/gestionpbi/backend/Movimiento.xlsx';
    console.log('Inspecting:', filePath);
    try {
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        console.log('Header Row:', data[0]);

        let found = 0;
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const doc = String(row[2] || ''); // Column 2 is DOC
            if (doc.startsWith('NE')) {
                console.log(`Row ${i} [${doc}]:`, row);
                found++;
                if (found > 5) break;
            }
        }
    } catch (err) {
        console.error(err.message);
    }
}

inspectExcel();
