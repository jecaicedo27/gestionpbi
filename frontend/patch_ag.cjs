const fs = require('fs');
let code = fs.readFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', 'utf8');

// 1. Remove ACCOUNT_GROUP_NAMES and rewrite useMemo for accountGroups
const regexAG = /const ACCOUNT_GROUP_NAMES = \{[\s\S]*?\};\s*\/\/ ── Grouped by AccountGroup → Producto → Lotes ──────────────────────────────\s*const accountGroups = useMemo\(\(\) => \{[\s\S]*?return Object\.values\(agMap\)[\s\S]*?\}\);\s*\}, \[allLotRows\]\);/g;

const newAG = `// ── Grouped by AccountGroup → Producto → Lotes ──────────────────────────────
    const accountGroups = useMemo(() => {
        const agMap = {};
        for (const row of allLotRows) {
            let baseGroupName = row.lot.product?.group?.name || 'GENERICO';
            if (baseGroupName === 'GENERICO' && row.lot._source === 'FINISHED_LOT') {
                baseGroupName = 'PRODUCTOS EN PROCESO LIQUIPOPS';
            }
            if (baseGroupName === 'Uncategorized') {
                baseGroupName = 'MATERIA PRIMA GENERAL';
            }

            const ag = baseGroupName;
            const agName = baseGroupName;

            if (!agMap[ag]) agMap[ag] = { agId: ag, agName, products: {} };
            const pid = row.lot.productId || row.lot.siigoProductCode || row.lot.siigoProductName || 'unknown';
            if (!agMap[ag].products[pid]) {
                agMap[ag].products[pid] = {
                    productId: pid,
                    productName: row.lot.siigoProductName || row.lot.product?.name || '—',
                    productCode: row.lot.siigoProductCode || '',
                    siigoTotal: extractSiigoTotal(row.lot),
                    separatedQty: pickedSummary[pid] || 0,
                    lots: []
                };
            }
            agMap[ag].products[pid].lots.push(row);
        }
        return Object.values(agMap)
            .sort((a, b) => String(a.agId).localeCompare(String(b.agId)))
            .map(ag => ({
                ...ag,
                products: Object.values(ag.products).sort((a, b) => a.productName.localeCompare(b.productName))
            }));
    }, [allLotRows, pickedSummary]);`;

code = code.replace(regexAG, newAG);

// 2. Add pickedSummary dependency to the search/filter useMemo?
// Wait, pickedSummary is already dependency of accountGroups useMemo!
// Let's replace the Header titles
code = code.replace('<th className="text-left px-4 py-3 text-xs font-semibold text-green-600 uppercase tracking-wide">📦 Físico</th>',
'<th className="text-left px-4 py-3 text-xs font-semibold text-rose-600 uppercase tracking-wide">📦 Separados</th>\n    <th className="text-left px-4 py-3 text-xs font-semibold text-green-600 uppercase tracking-wide">📦 Físico (Estante)</th>');

// 3. Replace the Product Total + Separado Pill
const replacePill = `{group.siigoTotal != null && (
                                                                                <span className="ml-2 inline-flex items-center gap-1.5 bg-indigo-100 text-indigo-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-indigo-200">
                                                                                    🔵 Total en Siigo: {fmtKg(group.siigoTotal)}
                                                                                </span>
                                                                            )}`;

const newPill = `{group.siigoTotal != null && (
                                                                                <span className="ml-2 inline-flex items-center gap-1.5 bg-indigo-100 text-indigo-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-indigo-200">
                                                                                    🔵 Total en Siigo: {group.productName?.toLowerCase().includes('liquipops') ? group.siigoTotal + ' uds' : fmtKg(group.siigoTotal)}
                                                                                </span>
                                                                            )}
                                                                            {group.separatedQty > 0 && (
                                                                                <span className="ml-2 inline-flex items-center gap-1.5 bg-rose-100 text-rose-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-rose-200">
                                                                                    📦 Separados (Sin facturar): {group.productName?.toLowerCase().includes('liquipops') ? group.separatedQty + ' uds' : fmtKg(group.separatedQty)}
                                                                                </span>
                                                                            )}`;
code = code.replace(replacePill, newPill);

// 4. Update the colSpan rendering
code = code.replace('colSpan={activeSession.status === \'IN_PROGRESS\' ? 7 : 6}', 'colSpan={activeSession.status === \'IN_PROGRESS\' ? 8 : 7}');
code = code.replace('const colCount = isEditable ? 7 : 6;', 'const colCount = isEditable ? 8 : 7;');

// 5. Insert the Extra TD for SEPARADOS in Header and Content
// Header:
code = code.replace('<td className="px-4 py-2.5" colSpan={2}>', '<td className="px-4 py-2.5" colSpan={3}>');

// Content:
// For inactive LOTS:
code = code.replace('<td className="px-4 py-2 text-neutral-500 text-sm">{fmtGrams(systemGrams, lot.unit)}</td>', 
'<td className="px-4 py-2 text-neutral-500 text-sm text-center">—</td>\n<td className="px-4 py-2 text-neutral-500 text-sm">{fmtGrams(systemGrams, lot.unit)}</td>');

// For Active LOTS:
code = code.replace('<td className="px-4 py-2.5 text-blue-700 font-semibold text-sm">{fmtGrams(systemGrams, lot.unit)}</td>',
'<td className="px-4 py-2.5 text-rose-600 font-bold text-center text-sm">{typeof lot.lotNumber === "string" && lot.lotNumber === "S/L" ? "" : "—"}</td>\n<td className="px-4 py-2.5 text-blue-700 font-semibold text-sm">{fmtGrams(systemGrams, lot.unit)}</td>');


fs.writeFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', code);
console.log('Patch complete.');
