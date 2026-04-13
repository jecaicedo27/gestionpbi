const fs = require('fs');
let code = fs.readFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', 'utf8');

// 1. the scanner input and last scan
const uiStartTgt = `<div className="flex flex-col sm:flex-row gap-4 mb-8">
                            <div className="flex-1 relative">
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-neutral-400">🔍</span>
                                <input type="text"`;
const uiStartRpl = `<div className="mb-4">
                                <input 
                                    ref={scannerInputRef} 
                                    type="text" 
                                    className="opacity-0 absolute -z-10 w-0 h-0" 
                                    value={scannerText} 
                                    onChange={(e) => setScannerText(e.target.value)} 
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleScannerInput(scannerText); }} 
                                />
                                {lastScan && (
                                    <div className={\`p-3 rounded-lg text-sm font-medium flex items-center gap-2 \${lastScan.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}\`}>
                                        <span>{lastScan.status === 'success' ? '✅' : '❌'}</span>
                                        {lastScan.message}
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-col sm:flex-row gap-4 mb-8">
                            <div className="flex-1 relative">
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-neutral-400">🔍</span>
                                <input data-scanner-ignore="true" type="text"`;

code = code.replace(uiStartTgt, uiStartRpl);

// 2. update inputs in the render logic
code = code.replaceAll('localInput.physicalKg', 'localInput.physicalGrams');
code = code.replaceAll("...m[key], physicalKg: e.target.value", "...m[key], physicalGrams: e.target.value");
code = code.replaceAll("onChange={e => setInputMap", 'data-scanner-ignore="true" onChange={e => setInputMap');
code = code.replaceAll("fmtKg((parseFloat(localInput.physicalGrams) || 0) * 1000)", "fmtGrams(parseFloat(localInput.physicalGrams) || 0, lot.unit)");
code = code.replaceAll("fmtKg(systemGrams)", "fmtGrams(systemGrams, lot.unit)");
code = code.replaceAll("Físico (kg)", "Físico");

// 3. adding IDs to the rows for smooth scroll
code = code.replaceAll("<tr key={lot.id} className=", "<tr id={`row-desktop-${lot.id}`} key={lot.id} className=");
code = code.replaceAll("<div key={lot.id} className=", "<div id={`row-mobile-${lot.id}`} key={lot.id} className=");

fs.writeFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', code);
