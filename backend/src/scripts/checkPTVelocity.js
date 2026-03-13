const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const XLSX = require('xlsx');
const path = require('path');

async function run() {
    try {
        // 1. Check PT Velocity in DB
        const ptProducts = await prisma.product.findMany({
            where: {
                type: { in: ['PERLA_EXPLOSIVA', 'SYRUP'] },
                dailyVelocity: { gt: 0 }
            },
            take: 10,
            orderBy: { dailyVelocity: 'desc' }
        });

        console.log(`\n--- PT Products with Velocity > 0: ${ptProducts.length} found ---`);
        ptProducts.forEach(p => console.log(`[${p.sku}] ${p.name}: ${p.dailyVelocity}`));

        if (ptProducts.length === 0) {
            console.log("⚠️ ALL Finished Products have 0 Velocity!");
        }

        // 2. Check Excel Sample for FV
        console.log('\n--- Excel Sample (FV Rows) ---');
        const filePath = path.join(__dirname, '../../Movimiento.xlsx');
        const workbook = XLSX.readFile(filePath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        let fvCount = 0;
        for (let i = 1; i < data.length && fvCount < 5; i++) {
            const row = data[i];
            const doc = row[2] ? String(row[2]).toUpperCase() : '';
            if (doc.startsWith('FV')) {
                console.log(`Row ${i}: Code='${row[0]}', Name='${row[1]}', Doc='${doc}', Out='${row[5]}'`);
                fvCount++;
            }
        }

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
