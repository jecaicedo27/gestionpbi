const fs = require('fs');
let code = fs.readFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', 'utf8');

// Inject S/L logic into allLotRows
const lotRowsTgt = `            return { lot, isActive, isCounted, physicalGrams, systemGrams, diff, zone: rawZone };
        });
    }, [systemLots, countLines, activeZone, isFinishedSession]);`;

const lotRowsRpl = `            return { lot, isActive, isCounted, physicalGrams, systemGrams, diff, zone: rawZone };
        });

        // Add S/L (Sin Lote) explicitly
        const slLines = countLines.filter(ln => !ln.lotId);
        slLines.forEach(ln => {
             const prod = systemLots.find(l => l.productId === ln.productId)?.product;
             rows.push({
                  lot: { id: \`nolot-\${ln.productId}\`, productId: ln.productId, lotNumber: 'S/L', currentQuantity: 0, product: prod, isGroup: true, productName: prod?.name || ln.productName, productCode: prod?.sku || ln.productCode },
                  isActive: true,
                  isCounted: true,
                  physicalGrams: ln.physicalQty,
                  systemGrams: 0,
                  diff: ln.physicalQty,
                  zone: activeZone || 'WAREHOUSE'
             });
        });

        return rows;
    }, [systemLots, countLines, activeZone, isFinishedSession]);`;

code = code.replace(lotRowsTgt, lotRowsRpl.replace("rows.push", "rows.push").replace("return rows;", "return rows;"));
code = code.replace("return activeLots.map(lot => {", "const rows = activeLots.map(lot => {");

fs.writeFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', code);
