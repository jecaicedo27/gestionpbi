const fs = require('fs');
let code = fs.readFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', 'utf8');

// 1. Imports
if(!code.includes('parseScanInput')) {
    code = code.replace("import api from '../services/api';", "import api from '../services/api';\nimport { parseScanInput } from '../services/scannerParser';\nimport { playSuccess, playError } from '../services/scannerSounds';");
}

// 2. State & Ref
if(!code.includes('scannerInputRef')) {
    code = code.replace("const [inputMap, setInputMap] = useState({});", "const [inputMap, setInputMap] = useState({});\n    const [systemProducts, setSystemProducts] = useState([]);\n    const [lastScan, setLastScan] = useState(null);\n    const scannerInputRef = useRef(null);");
}

// 3. Focus Interval
if(!code.includes('focusScanner')) {
    code = code.replace("const fetchSessions = useCallback(async () => {", `
    useEffect(() => {
        if (view !== 'session' || activeSession?.status !== 'IN_PROGRESS') return;
        const focusScanner = () => {
            if (scannerInputRef.current && 
                document.activeElement?.tagName !== 'INPUT' && 
                document.activeElement?.tagName !== 'TEXTAREA') {
                scannerInputRef.current.focus({ preventScroll: true });
            }
        };
        focusScanner();
        const interval = setInterval(focusScanner, 1500);
        return () => clearInterval(interval);
    }, [view, activeSession]);

    const fetchSessions = useCallback(async () => {`);
}

// 3.5. Load products
if(!code.includes("setSystemProducts(res.data)")) {
    code = code.replace("api.get('/inventory/lots?status=AVAILABLE,LOW_STOCK')", "api.get('/inventory/lots?status=AVAILABLE,LOW_STOCK'), api.get('/inventory/products')");
    code = code.replace("const [{ data: sess }, matRes, finRes, pickRes] = await Promise.all", "const [{ data: sess }, matRes, finRes, pickRes, prodRes] = await Promise.all");
    code = code.replace("setPickedSummary(pickRes.data || {});", "setPickedSummary(pickRes.data || {});\n            if(prodRes?.data) setSystemProducts(prodRes.data);");
}

// 4. Scanner Logic Functions
if(!code.includes('handleScannerInput =')) {
    code = code.replace("return (", `
    const handleScannerInput = useCallback(async (rawValue) => {
        if (!rawValue || rawValue.length < 4) return;
        const scan = parseScanInput(rawValue);
        
        let productMatch = systemProducts.find(p => p.sku === scan.sku || p.barcode === scan.barcode || p.sku === scan.barcode);
        if (!productMatch && scan.barcode) {
             productMatch = systemProducts.find(p => p.sku === scan.barcode);
        }

        if (!productMatch) {
            playError();
            setLastScan({ status: 'error', message: \`Producto no encontrado (\${scan.barcode || scan.sku})\` });
            return;
        }

        let targetRow = null;
        let isProductOnly = false;
        let targetItem = null;

        if (scan.lotNumber) {
            const cleanScanLotNum = scan.lotNumber.replace(/[^0-9]/g, '');
            const upperScanLot = scan.lotNumber.toUpperCase().trim();

            targetRow = allLotRows.find(r => r.isActive && r.lot.productId === productMatch.id && r.lot.lotNumber === scan.lotNumber);
            
            if (!targetRow) {
                targetRow = allLotRows.find(r => {
                    if (!r.isActive || r.lot.productId !== productMatch.id) return false;
                    const cleanDbLot = r.lot.lotNumber.replace(/[^0-9]/g, '');
                    const upperDbLot = r.lot.lotNumber.toUpperCase().trim();
                    if (cleanScanLotNum.length >= 6 && cleanDbLot === cleanScanLotNum) return true;
                    if (upperScanLot.includes(upperDbLot) || upperDbLot.includes(upperScanLot)) return true;
                    return false;
                });
            }
            if (targetRow) targetItem = targetRow.lot;
        }

        if (!targetItem) {
            const activeLots = allLotRows.filter(r => r.isActive && r.lot.productId === productMatch.id);
            if (activeLots.length === 1 && activeLots[0].lot.lotNumber !== 'S/L') {
                 targetItem = activeLots[0].lot;
            } else {
                 isProductOnly = true;
                 targetItem = {
                     productId: productMatch.id,
                     productName: productMatch.name,
                     productCode: productMatch.sku,
                     unit: productMatch.unit || 'gramo'
                 };
            }
        }

        const key = isProductOnly ? \`nolot-\${targetItem.productId}\` : targetItem.id;
        const qtyToAdd = scan.unitsPerBox || 1;

        setInputMap(m => {
             const startVal = parseFloat(m[key]?.physicalGrams);
             const safeCurrent = isNaN(startVal) ? 0 : startVal;
             const nextQty = safeCurrent + qtyToAdd;
             setTimeout(() => saveLotCount(targetItem, isProductOnly, nextQty), 50);
             return { ...m, [key]: { ...m[key], physicalGrams: nextQty } };
        });
        
        setTimeout(() => {
            const elements = document.querySelectorAll(\`[id="row-\${key}"]\`);
            for (const el of elements) {
                if (el.offsetParent !== null) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    break;
                }
            }
        }, 100);

        playSuccess();
        setLastScan({ status: 'success', message: \`+\${qtyToAdd} \${productMatch.name}\` });
    }, [systemProducts, allLotRows, saveLotCount]);

    const handleScannerInputFallback = useCallback((e, key, fallbackAction) => {
        if (e.key === 'Enter') {
            const val = e.target.value;
            const barcodeMatch = val.match(/(LOT:|BAR:|SKU:|{).*$/);
            if (barcodeMatch) {
                e.preventDefault();
                const scanString = barcodeMatch[0];
                handleScannerInput(scanString);
                const cleanVal = val.replace(scanString, '');
                setInputMap(m => ({ ...m, [key]: { ...m[key], physicalGrams: cleanVal } }));
            } else if (fallbackAction) {
                fallbackAction();
            }
        }
    }, [handleScannerInput]);

    const handlePhysicalInputChange = useCallback((key, val) => {
        if (val.includes('SKU:') || val.includes('LOT:') || val.includes('BAR:') || val.startsWith('{')) {
            setInputMap(m => ({ ...m, [key]: { ...m[key], physicalGrams: val } }));
            return;
        }
        const cleanVal = val.replace(/[^0-9.]/g, '');
        if (cleanVal.length > 8 && !cleanVal.includes('.')) return; 
        setInputMap(m => ({ ...m, [key]: { ...m[key], physicalGrams: cleanVal } }));
    }, []);

    return (`);
}

// 5. HIDDEN INPUT IN VIEW
if(!code.includes('ref={scannerInputRef}')) {
    code = code.replace(
        "{activeSession.status === 'IN_PROGRESS' && (",
        `{activeSession.status === 'IN_PROGRESS' && (
                        <input
                            ref={scannerInputRef}
                            type="text"
                            className="fixed -top-full -left-full opacity-0 outline-none w-0 h-0"
                            tabIndex={-1}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const rawValue = e.target.value.trim();
                                    e.target.value = '';
                                    if (rawValue) handleScannerInput(rawValue);
                                }
                            }}
                        />
                    )}
                    {lastScan && (
                        <div className={\`p-4 rounded-xl border flex items-center gap-4 shadow-sm transition-all \${lastScan.status === 'success' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}\`}>
                            <span className="text-2xl">{lastScan.status === 'success' ? '✅' : '❌'}</span>
                            <span className={\`font-bold \${lastScan.status === 'success' ? 'text-green-800' : 'text-red-800'}\`}>{lastScan.message}</span>
                        </div>
                    )}
                    {activeSession.status === 'IN_PROGRESS' && (`
    );
}

// 6. Update all 4 numeric inputs
code = code.replace(/onChange=\{e => setInputMap\(m => \(\{ \.\.\.m, \[key\]: \{ \.\.\.m\[key\], physicalGrams: e.target.value \} \}\)\)\}/g, "onChange={e => handlePhysicalInputChange(key, e.target.value)}");
code = code.replace(/onChange=\{e => setInputMap\(m => \(\{ \.\.\.m, \[`nolot-\$\{group\.productId\}`\]: \{ \.\.\.m\[`nolot-\$\{group\.productId\}`\], physicalGrams: e.target.value \} \}\)\)\}/g, "onChange={e => handlePhysicalInputChange(`nolot-${group.productId}`, e.target.value)}");

// Desktop Lot row
code = code.replace(/<input type="text" inputMode="numeric"(.*?)onChange=\{e => handlePhysicalInputChange\(key, e\.target\.value\)\}(.*?)onKeyDown=\{e => e\.key === 'Enter' && saveLotCount\(lot\)\}/gs, `<input type="text" inputMode="numeric" data-scanner-ignore="true"$1onChange={e => handlePhysicalInputChange(key, e.target.value)}$2onKeyDown={e => handleScannerInputFallback(e, key, () => saveLotCount(lot))}`);

// Desktop S/L row
code = code.replace(/<input type="text" inputMode="numeric"(.*?)onChange=\{e => handlePhysicalInputChange\(`nolot-\$\{group\.productId\}`, e\.target\.value\)\}(.*?)onKeyDown=\{e => e\.key === 'Enter' && saveLotCount\(group, true\)\}/gs, `<input type="text" inputMode="numeric" data-scanner-ignore="true"$1onChange={e => handlePhysicalInputChange(\`nolot-\${group.productId}\`, e.target.value)}$2onKeyDown={e => handleScannerInputFallback(e, \`nolot-\${group.productId}\`, () => saveLotCount(group, true))}`);

// Mobile Lot row (doesn't have onKeyDown originally)
code = code.replace(/<input type="text" inputMode="numeric"(.*?)onChange=\{e => handlePhysicalInputChange\(key, e\.target\.value\)\}(.*?)placeholder="0"/gs, `<input type="text" inputMode="numeric" data-scanner-ignore="true"$1onChange={e => handlePhysicalInputChange(key, e.target.value)}\n                                                                                onKeyDown={e => handleScannerInputFallback(e, key, () => saveLotCount(lot))}$2placeholder="0"`);

// Mobile S/L row (doesn't have onKeyDown originally)
code = code.replace(/<input type="text" inputMode="numeric"(.*?)onChange=\{e => handlePhysicalInputChange\(`nolot-\$\{group\.productId\}`, e\.target\.value\)\}(.*?)placeholder="0"/gs, `<input type="text" inputMode="numeric" data-scanner-ignore="true"$1onChange={e => handlePhysicalInputChange(\`nolot-\${group.productId}\`, e.target.value)}\n                                                                                onKeyDown={e => handleScannerInputFallback(e, \`nolot-\${group.productId}\`, () => saveLotCount(group, true))}$2placeholder="0"`);

fs.writeFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', code, 'utf8');
console.log('Patched');
