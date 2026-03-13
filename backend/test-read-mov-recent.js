const XLSX = require('xlsx');
const path = require('path');

async function readMov() {
    const filePath = '/var/www/gestionpbi/backend/Movimiento.xlsx';
    console.log('Reading:', filePath);
    try {
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        console.log('Total Rows:', data.length);

        let foundCount = 0;
        for (let i = data.length - 1; i > 0; i--) {
            const row = data[i];
            const doc = String(row[2] || '');
            if (doc.startsWith('NE')) {
                console.log(`Recent NE Found [Row ${i}]:`, row);
                foundCount++;
                if (foundCount > 5) break;
            }
        }

    } catch (err) {
        console.error(err.message);
    }
}

readMov();
