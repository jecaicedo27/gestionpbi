const XLSX = require('xlsx');
const path = require('path');

async function readLastNE() {
    const filePath = '/var/www/gestionpbi/backend/Movimiento 2025.xlsx';
    console.log('Reading:', filePath);
    try {
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        console.log('Total Rows:', data.length);

        // Find NE-1-10586 or latest NE
        let targetNE = 'NE-1-10586';
        let latestNE = null;
        let lastDate = new Date(0);

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const doc = String(row[2] || '');
            if (doc.startsWith('NE')) {
                const dateStr = row[3];
                const [d, m, y] = dateStr.split('/');
                const date = new Date(`${y}-${m}-${d}`);

                if (date > lastDate) {
                    lastDate = date;
                    latestNE = row;
                }

                if (doc === targetNE) {
                    console.log('Found NE-1-10586 Row:', row);
                }
            }
        }

        if (latestNE) {
            console.log('Latest NE found in file:', latestNE);
        }

    } catch (err) {
        console.error(err.message);
    }
}

readLastNE();
