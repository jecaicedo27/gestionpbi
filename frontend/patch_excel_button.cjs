const fs = require('fs');
let code = fs.readFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', 'utf8');

const regexBtn = /\{view === 'list' && \(\s*<button onClick=\{\(\) => setShowNewForm\(true\)\}/g;

const newBtn = `{view === 'list' && (
                        <>
                            <div className="relative group">
                                <button className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shadow-sm flex items-center gap-2">
                                    📊 Consolidado Siigo
                                    <span className="text-xs">▼</span>
                                </button>
                                <div className="absolute right-0 mt-2 w-48 bg-white border border-neutral-200 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                                    <div className="p-2 text-xs font-bold text-neutral-500 uppercase tracking-wider border-b border-neutral-100">Seleccionar Mes</div>
                                    <div className="py-1">
                                        {MONTH_OPTIONS.map(o => (
                                            <a key={o.val} href={\`/api/inventory-count/export/month/\${o.val}\`} target="_blank" className="block px-4 py-2 text-sm text-neutral-700 hover:bg-emerald-50 hover:text-emerald-700">
                                                {o.label}
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => setShowNewForm(true)}
`;

code = code.replace(regexBtn, newBtn);

fs.writeFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', code);
console.log('Patch 2 complete.');
