const fs = require('fs');
let code = fs.readFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', 'utf8');

// Fix S/L line mapping logic so it uses lineId properly!
code = code.replace("lines.forEach(ln => {", "lines.forEach(ln => {\n                if(!ln.lotId) ln.lotNumber = 'S/L';");
code = code.replace("const key = ln.lotId || ln.lotNumber;", "const key = ln.lotId ? ln.lotId : \`nolot-\${ln.productId}\`;");

const saveOrig = `            const payload = {
                productId: lot.productId || null,
                productName: lot.siigoProductName || (lot.product?.name) || lot.productName || 'Unknown',
                productCode: lot.siigoProductCode || lot.productCode,
                lotId: isGroup ? null : lot.id,
                lotNumber: isGroup ? 'S/L' : lot.lotNumber,
                physicalQty: physicalGramsVal,
                unit: lot.unit || 'gramo',
                notes: inp.notes || null
            };`;

const saveRepl = `            const payload = {
                lineId: inp.lineId || null,
                productId: lot.productId || null,
                productName: lot.siigoProductName || (lot.product?.name) || lot.productName || 'Unknown',
                productCode: lot.siigoProductCode || lot.productCode,
                lotId: isGroup ? null : lot.id,
                lotNumber: isGroup ? 'S/L' : lot.lotNumber,
                physicalQty: physicalGramsVal,
                unit: lot.unit || 'gramo',
                notes: inp.notes || null
            };`;

code = code.replace(saveOrig, saveRepl);

// Wait what about Excel export UI? We put it near "Nueva sesión" button!
const uiOrig = `                            <button onClick={() => setShowNewForm(true)} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors shadow-sm">
                                + Nueva sesión
                            </button>`;
const uiRepl = `                            <div className="flex gap-3">
                                {sessions.length > 0 && (
                                    <button onClick={() => window.open(\`/api/inventory-count/export/month/\${sessions[0].month}\`)} className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors shadow-sm">
                                        📊 Exportar Mes a Excel (Siigo)
                                    </button>
                                )}
                                <button onClick={() => setShowNewForm(true)} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors shadow-sm">
                                    + Nueva sesión
                                </button>
                            </div>`;
code = code.replace(uiOrig, uiRepl);

// Wait what about the "S/L" push duplicates in allLotRows?
const slOrig = `        const slLines = countLines.filter(ln => !ln.lotId);
        slLines.forEach(ln => {
             const prod = systemLots.find(l => l.productId === ln.productId)?.product;
             rows.push({`;
const slRepl = `        // Group S/L lines to avoid duplicates in view if database had any 
        const slLines = countLines.filter(ln => !ln.lotId);
        const slMap = {};
        slLines.forEach(ln => { if(!slMap[ln.productId]) slMap[ln.productId] = ln; });
        Object.values(slMap).forEach(ln => {
             const prod = systemLots.find(l => l.productId === ln.productId)?.product;
             rows.push({`;
code = code.replace(slOrig, slRepl);             

fs.writeFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', code);
