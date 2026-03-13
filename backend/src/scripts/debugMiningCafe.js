
const XLSX = require('xlsx');
const path = require('path');

async function main() {
    try {
        const filePath = path.join(__dirname, '../../Movimiento.xlsx');
        console.log(`Reading ${filePath}...`);

        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        const COL_CODE = 0;
        const COL_NAME = 1;
        const COL_DATE = 3;
        const COL_EXIT = 5;

        // 0. Finding Max Date
        let globalMaxDate = new Date(0);
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

        console.log(`\n📅 Global Max Date: ${globalMaxDate.toISOString().split('T')[0]}`);
        console.log(`📅 Cutoff Date (90 days ago): ${cutoffDate.toISOString().split('T')[0]}`);

        // 1. Finding Liquipops
        let totalExit = 0;
        let count = 0;
        let recentCount = 0;

        console.log(`\n🔍 Scanning for Liquipops Blueberry 1150...`);

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const name = row[COL_NAME] ? String(row[COL_NAME]).toUpperCase() : '';
            const code = row[COL_CODE] ? String(row[COL_CODE]) : '';
            const qtyExit = parseFloat(row[COL_EXIT]) || 0;
            const dateStr = row[COL_DATE];

            if (name.includes('LIQUI') && name.includes('BLUE') && name.includes('1150')) {
                count++;

                const [d, m, y] = dateStr ? dateStr.split('/') : [0, 0, 0];
                const date = new Date(`${y}-${m}-${d}`);

                const isRecent = date >= cutoffDate;
                if (isRecent) {
                    recentCount++;
                    totalExit += qtyExit;
                    console.log(` ✅ FOUND RECENT: ${dateStr} - Qty: ${qtyExit} - Name: ${name}`);
                } else {
                    // console.log(` ❌ SKIPPED OLD: ${dateStr}`);
                }
            }
        }

        console.log(`\n📊 Summary:`);
        console.log(`   Total Entries Found: ${count}`);
        console.log(`   Recent Entries (> ${cutoffDate.toISOString().split('T')[0]}): ${recentCount}`);
        console.log(`   Total Consumption (Recent): ${totalExit}`);

    } catch (error) {
        console.error(error);
    }
}

main();
