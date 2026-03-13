const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '../../Movimiento.xlsx');

function analyzeProduct(targetCode) {
    console.log(`🔍 Analyzing product: ${targetCode}`);

    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    const COL_CODE = 0;
    const COL_DOC = 2;
    const COL_DATE = 3;
    const COL_EXIT = 5;

    let globalMaxDate = new Date(0);
    // Find max date first
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const dateStr = row[COL_DATE];
        if (!dateStr) continue;
        const [d, m, y] = dateStr.split('/');
        const date = new Date(`${y}-${m}-${d}`);
        if (!isNaN(date) && date > globalMaxDate) {
            globalMaxDate = date;
        }
    }

    const cutoffDate = new Date(globalMaxDate);
    cutoffDate.setDate(globalMaxDate.getDate() - 90);

    console.log(`📅 Analysis Window: ${cutoffDate.toISOString().split('T')[0]} to ${globalMaxDate.toISOString().split('T')[0]}`);

    let totalExit = 0;
    let validRows = 0;
    let rejectedRows = 0;

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const code = row[COL_CODE] ? String(row[COL_CODE]).trim() : null;

        if (code !== targetCode) continue;

        const doc = row[COL_DOC] ? String(row[COL_DOC]).toUpperCase() : '';
        const qtyExit = parseFloat(row[COL_EXIT]) || 0;
        const dateStr = row[COL_DATE];

        if (!dateStr) continue;

        const [d, m, y] = dateStr.split('/');
        const date = new Date(`${y}-${m}-${d}`);

        const isConsumption = (doc.startsWith('NE') || doc.startsWith('FV')) && qtyExit > 0;
        const inWindow = date >= cutoffDate;

        console.log(`Row: Date=${dateStr}, Doc=${doc}, Exit=${qtyExit}, InWindow=${inWindow}, IsConsumption=${isConsumption}`);

        if (inWindow && isConsumption) {
            totalExit += qtyExit;
            validRows++;
        } else {
            rejectedRows++;
        }
    }

    console.log('--- Summary ---');
    console.log(`Total Consumption in Window: ${totalExit}`);
    console.log(`Valid Rows: ${validRows}`);
    console.log(`Rejected Rows (Out of date or wrong doc type): ${rejectedRows}`);
    console.log(`Calculated Velocity: ${totalExit / 90}`);
}

analyzeProduct('GENI16');
