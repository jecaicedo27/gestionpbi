/**
 * tsplLabelBuilder.js — Generate TSPL commands for SAT AF 330
 *
 * Label size: 80mm × 50mm at 203 DPI
 * 80mm ≈ 640 dots,  50mm ≈ 400 dots
 * Max print width: 72mm ≈ 576 dots
 *
 * TSPL reference: https://www.tscprinters.com/EN/DownloadFile
 */
import { buildQrString } from './qrService';

/**
 * Build TSPL commands for a material lot label.
 *
 * @param {Object} data
 * @param {string} data.productName  — "LIQUIPOPS SABOR A CHAMOY X 350 GR"
 * @param {string} data.sku          — "LIQD14"
 * @param {string} data.lotNumber    — "13070976"
 * @param {number} data.quantity     — initial quantity
 * @param {string} data.unit         — "unidad" | "gramo"
 * @param {string} data.supplier     — "TECNAS S.A. BIC."
 * @param {string} data.receivedAt   — ISO date string
 * @param {string} data.expiresAt    — ISO date string or null
 * @param {string} [data.orderNumber]— "OC-001"
 * @param {number} [copies=1]        — number of copies
 * @returns {string} TSPL command string
 */
export function buildLotLabel(data, copies = 1, { maquila = false } = {}) {
    const {
        productName = '', sku = '', lotNumber = '',
        quantity = 0, unit = 'unidad', supplier = '',
        receivedAt = '', expiresAt = '', orderNumber = '',
        barcode = '', statusText = null
    } = data;

    // Format quantity
    const isWeight = unit === 'gramo' || unit === 'g';
    const qtyText = isWeight
        ? `${quantity.toLocaleString('es-CO')} g`
        : `${quantity.toLocaleString('es-CO')} ${unit || 'und'}`;

    // Format dates — "Recep" is actually fabrication date
    const fmtDate = (d) => {
        if (!d) return 'N/A';
        try { return new Date(d).toLocaleDateString('es-CO'); } catch { return 'N/A'; }
    };
    const fabDate = fmtDate(receivedAt);

    // Auto-calculate expiration: fabrication + 9 months
    let expDate = 'N/A';
    if (expiresAt) {
        expDate = fmtDate(expiresAt);
    } else if (receivedAt) {
        const exp = new Date(receivedAt);
        exp.setMonth(exp.getMonth() + 9);
        expDate = exp.toLocaleDateString('es-CO');
    }

    const truncateText = (value, maxChars) => {
        const text = String(value || '').trim();
        if (!text || text.length <= maxChars) return text;
        return `${text.slice(0, Math.max(0, maxChars - 2)).trim()}..`;
    };

    const splitPlainName = (value, targetChars = 16) => {
        const text = String(value || '').trim();
        if (!text) return [ '', '' ];

        const words = text.split(/\s+/).filter(Boolean);
        if (words.length < 2 || text.length <= targetChars) {
            return [ truncateText(text, targetChars), '' ];
        }

        let line1 = '';
        let line2 = '';
        for (let i = 0; i < words.length; i += 1) {
            const candidate = line1 ? `${line1} ${words[i]}` : words[i];
            if (candidate.length <= targetChars || !line1) {
                line1 = candidate;
            } else {
                line2 = words.slice(i).join(' ');
                break;
            }
        }

        if (!line2 && words.length > 1) {
            const mid = Math.ceil(words.length / 2);
            line1 = words.slice(0, mid).join(' ');
            line2 = words.slice(mid).join(' ');
        }

        return [ truncateText(line1, targetChars), truncateText(line2, targetChars) ];
    };

    // ── Smart product name split into 3 lines ──
    // "LIQUIPOPS SABOR A MANGO BICHE CON SAL X 1150 GR"
    //  → Line 1: "LIQUIPOPS SABOR A"
    //  → Line 2: "MANGO BICHE CON SAL"
    //  → Line 3: "X 1150 GR"
    let nameLine1 = productName, nameLine2 = '', nameLine3 = '';
    if (maquila) {
        // Maquila: generic name "PERLAS EXPLOSIVAS {SABOR} X {size}"
        const saborMatch2 = productName.match(/SABOR A\s+(.+?)\s+X\s+/i);
        const flavor = saborMatch2 ? saborMatch2[1].trim() : '';
        const sizeMatch = productName.match(/(\d{3,4}\s*G[R]?)/i);
        nameLine1 = 'PERLAS EXPLOSIVAS';
        nameLine2 = flavor;
        nameLine3 = sizeMatch ? `X ${sizeMatch[1]}` : '';
    } else {
        const saborMatch = productName.match(/^(.+?SABOR A\s?)(.+?)(\s+X\s+\d+.*)$/i);
        if (saborMatch) {
            nameLine1 = saborMatch[1].trim();
            nameLine2 = saborMatch[2].trim();
            nameLine3 = saborMatch[3].trim();
        } else {
            // Fallback: split by "X \d"
            const sizeMatch = productName.match(/^(.+?)(\s+X\s+\d+.*)$/i);
            if (sizeMatch) {
                const [plainLine1, plainLine2] = splitPlainName(sizeMatch[1], 16);
                nameLine1 = plainLine1;
                nameLine2 = plainLine2;
                nameLine3 = sizeMatch[2].trim();
            } else {
                // No size spec — split long names to keep them inside the left column
                const [plainLine1, plainLine2] = splitPlainName(productName, 16);
                nameLine1 = plainLine1;
                nameLine2 = plainLine2;
            }
        }
    }

    // Extract actual lot code from full lot string
    let lotDisplay = lotNumber;
    if (/[a-zA-Z]/.test(lotNumber)) {
        const parts = lotNumber.split('-');
        lotDisplay = parts.length >= 2 ? parts.slice(-2).join('-') : parts[parts.length - 1];
    }
    if (lotDisplay.length > 20) lotDisplay = lotDisplay.substring(0, 20) + '..';
    const qtyDisplay = qtyText.substring(0, 18);

    // QR content — canonical format from qrService (single source of truth)
    const boxNum = data.boxNumber || 1;
    const boxTotal = data.totalBoxes || 1;
    const qrContent = buildQrString({ lotNumber, sku, barcode: barcode || sku, quantity, boxNumber: boxNum, totalBoxes: boxTotal });

    // ── Layout: text LEFT (14-340), QR RIGHT (400+) ──
    const textW = 340;
    const qrX = 400;
    const qrY = 45;
    const qrCell = 5;   // reduced to fit reliably

    // All Y positions (fixed layout with 3 name lines)
    let y = 36;
    const cmds = [
        // ── Setup ──
        'SIZE 80 mm, 50 mm',
        'GAP 2 mm, 0',
        'SPEED 3',
        'DENSITY 8',
        'DIRECTION 1',
        'CLS',

        // ── Company Header (skip for maquila or statusText) ──
        ...(statusText ? [
            `REVERSE 0,0,576,34`,
            `TEXT 20,10,"1",0,1,1,"${escapeTspl(statusText)}"`,
            'BAR 10,36,556,2',
        ] : maquila ? [] : [
            `TEXT 10,10,"1",0,1,1,"POPPING BOBA INTERNATIONAL S.A.S."`,
            'BAR 10,28,556,2',
        ]),

        // ── Product Name — line1 normal, FLAVOR (line2) 2x, line3 normal ──
        `TEXT 14,${y},"2",0,1,1,"${escapeTspl(truncateText(nameLine1, 16))}"`,
    ];

    y += 22;
    if (nameLine2) {
        // Max ~12 chars at 2x scale before hitting QR at x=400
        if (nameLine2.length > 12) {
            // Split into 2 lines at last space before char 12, or at 12
            const cutAt = nameLine2.lastIndexOf(' ', 13);
            const splitPos = cutAt > 4 ? cutAt : 12;
            const flavorL1 = truncateText(nameLine2.substring(0, splitPos).trim(), 12);
            const flavorL2 = truncateText(nameLine2.substring(splitPos).trim(), 12);
            cmds.push(`TEXT 14,${y},"3",0,2,2,"${escapeTspl(flavorL1)}"`);
            y += 40;
            if (flavorL2) {
                cmds.push(`TEXT 14,${y},"3",0,2,2,"${escapeTspl(flavorL2)}"`);
                y += 40;
            }
        } else {
            cmds.push(`TEXT 14,${y},"3",0,2,2,"${escapeTspl(truncateText(nameLine2, 12))}"`);
            y += 44;
        }
    }
    if (nameLine3) {
        cmds.push(`TEXT 14,${y},"2",0,1,1,"${escapeTspl(truncateText(nameLine3, 16))}"`);
        y += 22;
    }

    // ── SKU + Lote ──
    y += 4;
    if (!maquila) {
        cmds.push(`TEXT 14,${y},"2",0,1,1,"SKU: ${escapeTspl(sku.substring(0, 20))}"`);
        y += 22;
    }
    cmds.push(`TEXT 14,${y},"2",0,1,1,"Lote: ${escapeTspl(lotDisplay)}"`);

    // ── Quantity ──
    y += 26;
    cmds.push(`TEXT 14,${y},"3",0,1,1,"${escapeTspl(qtyDisplay)}"`);

    // ── Dates ──
    y += 28;
    cmds.push(`TEXT 14,${y},"2",0,1,1,"Fab: ${fabDate}"`);
    y += 22;
    cmds.push(`TEXT 14,${y},"2",0,1,1,"Vence: ${expDate}"`);

    // ── Vertical separator ──
    cmds.push(`BAR ${textW + 15},32,2,${y - 30}`);

    // ── QR Code — RIGHT SIDE ──
    cmds.push(`QRCODE ${qrX},${qrY},M,${qrCell},A,0,"${escapeTspl(qrContent)}"`);
    // Box number under QR
    if (boxTotal > 1) {
        cmds.push(`TEXT ${qrX},${qrY + qrCell * 25 + 8},"2",0,1,1,"Caja ${boxNum}/${boxTotal}"`);
    }

    // ── Bottom bar + timestamp ──
    y += 26;
    cmds.push(`BAR 10,${y},556,2`);
    y += 6;
    cmds.push(`TEXT 10,${y},"1",0,1,1,"${new Date().toLocaleDateString('es-CO')} ${new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}"`);
    if (orderNumber) cmds.push(`TEXT 280,${y},"1",0,1,1,"OC: ${escapeTspl(orderNumber)}"`);

    // ── Print 1 label per call (copies handled by caller loop) ──
    cmds.push(`PRINT 1`);

    return cmds.join('\n') + '\n';
}

/**
 * Build a simple test label to verify printer connectivity
 * @returns {string} TSPL commands
 */
export function buildTestLabel() {
    return [
        'SIZE 80 mm, 50 mm',
        'GAP 2 mm, 0',
        'SPEED 3',
        'DENSITY 8',
        'DIRECTION 1',
        'CLS',
        'TEXT 100,50,"4",0,1,1,"TEST LABEL"',
        'TEXT 80,120,"3",0,1,1,"SAT AF 330 OK"',
        `TEXT 100,200,"2",0,1,1,"${new Date().toLocaleString('es-CO')}"`,
        'QRCODE 180,250,M,7,A,0,"POPPING-BOBA-TEST"',
        'PRINT 1',
    ].join('\n') + '\n';
}

/**
 * Escape special characters for TSPL strings
 */
function escapeTspl(str) {
    if (!str) return '';
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, ' ')
        .replace(/\r/g, '');
}
