const fs = require('fs');
let code = fs.readFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', 'utf8');

const handleScanStr = `
    const handleScannerInput = useCallback(async (rawValue) => {
        if (!rawValue || rawValue.length < 4) return;
        const scan = parseScanInput(rawValue);
        
        let productMatch = systemLots.map(l => l.product).find(p => p && (p.sku === scan.sku || p.barcode === scan.barcode || p.sku === scan.barcode));
        if (!productMatch && scan.barcode) {
             productMatch = systemLots.map(l => l.product).find(p => p && p.sku === scan.barcode);
        }

        if (!productMatch) {
            playError();
            setLastScan({ status: 'error', message: \`Producto no encontrado (\${scan.barcode || scan.sku})\` });
            setScannerText('');
            return;
        }

        let targetRow = null;
        let isProductOnly = false;
        let targetItem = null;

        // allLotRows is not in scope here immediately, we must find it
        const currentActiveSession = activeSession;
        if (scan.lotNumber) {
            const rowLot = systemLots.find(l => l.productId === productMatch.id && l.lotNumber === scan.lotNumber);
            if (rowLot) targetItem = rowLot;
        }

        if (!targetItem) {
            const activeLotsForProduct = systemLots.filter(l => l.productId === productMatch.id && ['AVAILABLE', 'LOW_STOCK'].includes(l.status));
            if (activeLotsForProduct.length === 1 && activeLotsForProduct[0].lotNumber !== 'S/L') {
                 targetItem = activeLotsForProduct[0];
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

        setTimeout(() => {
            let rowElement = document.getElementById(\`row-desktop-\${key}\`);
            if (!rowElement || rowElement.offsetParent === null) {
                rowElement = document.getElementById(\`row-mobile-\${key}\`);
            }
            if (rowElement) {
                rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                rowElement.classList.add('bg-blue-100', 'ring-2', 'ring-blue-400');
                rowElement.style.transition = 'all 0.5s';
                setTimeout(() => rowElement.classList.remove('bg-blue-100', 'ring-2', 'ring-blue-400'), 2000);
            }
        }, 50);

        setInputMap(m => {
             const startVal = parseFloat(m[key]?.physicalGrams);
             const safeCurrent = isNaN(startVal) ? 0 : startVal;
             const nextQty = safeCurrent + qtyToAdd;
             
             setTimeout(() => saveLotCount(isProductOnly ? { ...targetItem, isGroup: true } : targetItem), 50);

             return { ...m, [key]: { ...m[key], physicalGrams: nextQty } };
        });
        
        playSuccess();
        setLastScan({ status: 'success', message: \`+\${qtyToAdd} \${productMatch.name}\` });
        setScannerText('');
    }, [systemLots, activeSession]);

    const handlePhysicalInputChange = useCallback((key, val) => {
        if (val && (val.includes('SKU:') || val.includes('LOT:') || val.includes('BAR:') || val.startsWith('{') || val.length > 20)) {
            handleScannerInput(val);
            return;
        }
        setInputMap(m => ({ ...m, [key]: { ...m[key], physicalGrams: val } }));
    }, [handleScannerInput]);
`;

code = code.replace("    const saveLotCount = useCallback(async (lot) => {", handleScanStr + "\n    const saveLotCount = useCallback(async (lot) => {");

// Update saveLotCount logic
const saveTgt = `    const saveLotCount = useCallback(async (lot) => {
        if (!activeSession) return;
        const key = lot.id;
        const inp = inputMap[key] || {};
        const physicalKg = parseFloat(inp.physicalKg);
        if (isNaN(physicalKg)) return alert('Ingrese un valor numérico para físico');
        setSavingMap(m => ({ ...m, [key]: true }));
        try {
            const payload = {
                productId: lot.productId,
                productName: lot.siigoProductName || (lot.product?.name) || 'Unknown',
                productCode: lot.siigoProductCode,
                lotId: lot.id,
                lotNumber: lot.lotNumber,
                physicalQty: Math.round(physicalKg * 1000),
                unit: 'gramo',
                notes: inp.notes || null
            };`;
const saveRpl = `    const saveLotCount = useCallback(async (lot) => {
        if (!activeSession) return;
        
        const isGroup = lot.isGroup;
        const key = isGroup ? \`nolot-\${lot.productId}\` : lot.id;
        const inp = inputMap[key] || {};
        const physicalGramsVal = parseFloat(inp.physicalGrams);
        
        if (isNaN(physicalGramsVal)) return alert('Ingrese un valor numérico para físico');
        setSavingMap(m => ({ ...m, [key]: true }));
        try {
            const payload = {
                productId: lot.productId,
                productName: lot.siigoProductName || (lot.product?.name) || lot.productName || 'Unknown',
                productCode: lot.siigoProductCode || lot.productCode,
                lotId: isGroup ? null : lot.id,
                lotNumber: isGroup ? 'S/L' : lot.lotNumber,
                physicalQty: physicalGramsVal,
                unit: lot.unit || 'gramo',
                notes: inp.notes || null
            };`;
            
code = code.replace(saveTgt, saveRpl);
fs.writeFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', code);
