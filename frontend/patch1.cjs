const fs = require('fs');
let code = fs.readFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage_bkp.jsx', 'utf8');

// 1. Add imports
code = code.replace("import { useState, useEffect, useCallback, useMemo } from 'react';", "import { useState, useEffect, useCallback, useMemo, useRef } from 'react';\nimport { parseScanInput } from '../services/scannerParser';\nimport { useGlobalScanner } from '../hooks/useGlobalScanner';");

// 2. Change fmtKg to fmtGrams and add units
code = code.replace("const fmtKg = (grams) => {", "const fmtGrams = (grams, unit = 'gramo') => {\n    if (grams == null || grams === '') return '—';\n    const n = Number(grams);\n    if (isNaN(n)) return '—';\n    if (unit !== 'gramo') return `${n.toFixed(0)} ${unit}s`;\n    return n >= 1000 ? `${(n / 1000).toFixed(2)} kg` : `${n.toFixed(0)} g`;\n};\nconst fmtKg = (grams) => {");

// 3. Update diffBadge
code = code.replace("const diffBadge = (diff) => {", "const diffBadge = (diff, unit = 'gramo') => {");
code = code.replace("return { bg: '#fef2f2', color: '#dc2626', text: `−${fmtKg(abs)}` };\n    return { bg: '#fffbeb', color: '#d97706', text: `+${fmtKg(abs)}` };", "return { bg: '#fef2f2', color: '#dc2626', text: `−${fmtGrams(abs, unit)}` };\n    return { bg: '#fffbeb', color: '#d97706', text: `+${fmtGrams(abs, unit)}` };");

fs.writeFileSync('/var/www/gestionpbi/frontend/src/pages/InventoryCountPage.jsx', code);
