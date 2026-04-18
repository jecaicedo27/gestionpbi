const { exportMonthExcel } = require('./src/controllers/inventoryCountController');
const { PrismaClient } = require('@prisma/client');
global.prisma = new PrismaClient();
const req = { params: { month: '2026-04' } };
const res = { 
  setHeader: () => {}, 
  send: (buf) => { 
    const xlsx = require('xlsx');
    const wb = xlsx.read(buf);
    const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const item = data.find(r => r['Código Producto'] === 'GENG15');
    console.log("EXCEL GENG15 ROW:");
    console.log(item);
  },
  status: (c) => ({ json: console.log })
};
exportMonthExcel(req, res).then(() => {
    console.log("Done");
    process.exit(0);
});
