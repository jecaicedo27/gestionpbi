/**
 * zplLabelBuilder.js — Generate ZPL commands for Zebra ZD230t
 *
 * Label size: 80mm × 50mm at 203 DPI (8 dots/mm)
 * 80mm = 640 dots,  50mm = 400 dots
 *
 * ZPL reference: https://www.zebra.com/content/dam/zebra/manuals/printers/common/programming/zpl-zbi2-pm-en.pdf
 */

/**
 * Build ZPL commands for a material lot label.
 *
 * @param {Object} data  — same shape as tsplLabelBuilder
 * @param {number} [copies=1]
 * @returns {string} ZPL command string
 */
export function buildLotLabelZPL(data, copies = 1) {
    const {
        productName = '', sku = '', lotNumber = '',
        quantity = 0, unit = 'unidad', supplier = '',
        receivedAt = '', expiresAt = '', orderNumber = '',
        barcode = ''
    } = data;

    // Format quantity
    const isWeight = unit === 'gramo' || unit === 'g';
    const qtyText = isWeight
        ? `${(quantity / 1000).toFixed(1)} kg`
        : `${quantity.toLocaleString('es-CO')} ${unit || 'und'}`;

    // Format dates
    const fmtDate = (d) => {
        if (!d) return 'N/A';
        try { return new Date(d).toLocaleDateString('es-CO'); } catch { return 'N/A'; }
    };
    const fabDate = fmtDate(receivedAt);
    let expDate = 'N/A';
    if (expiresAt) {
        expDate = fmtDate(expiresAt);
    } else if (receivedAt) {
        const exp = new Date(receivedAt);
        exp.setMonth(exp.getMonth() + 9);
        expDate = exp.toLocaleDateString('es-CO');
    }

    // ── Product name — extract flavor ──
    let nameLine1 = productName, nameLine2 = '', nameLine3 = '';
    const saborMatch = productName.match(/^(.+?SABOR A\s?)(.+?)(\s+X\s+\d+.*)$/i);
    if (saborMatch) {
        nameLine1 = saborMatch[1].trim();
        nameLine2 = saborMatch[2].trim();
        nameLine3 = saborMatch[3].trim();
    } else {
        const sizeMatch = productName.match(/^(.+?)(\s+X\s+\d+.*)$/i);
        if (sizeMatch) {
            nameLine1 = sizeMatch[1].trim().substring(0, 28);
            nameLine3 = sizeMatch[2].trim();
        } else {
            nameLine1 = productName.substring(0, 28);
        }
    }

    // Lot display
    let lotDisplay = lotNumber;
    if (/[a-zA-Z]/.test(lotNumber)) {
        const parts = lotNumber.split('-');
        lotDisplay = parts.length >= 2 ? parts.slice(-2).join('-') : parts[parts.length - 1];
    }
    if (lotDisplay.length > 22) lotDisplay = lotDisplay.substring(0, 22) + '..';

    // QR content
    const boxNum = data.boxNumber || 1;
    const boxTotal = data.totalBoxes || 1;
    const qrContent = `LOT:${lotNumber}|SKU:${sku}|BAR:${barcode || sku}|QTY:${quantity}|BOX:${boxNum}/${boxTotal}`;

    // ── Build ZPL for 40mm × 50mm label (2-up) ──
    // Single label: ~37mm usable = 296 dots at 203 DPI
    let y = 6;
    const textX = 6;
    const W = 284; // usable width with margins

    let zpl = '^XA\n';
    zpl += '^MMT\n';         // Thermal transfer mode
    zpl += '^PW296\n';       // Print width ~37mm (safe for 40mm with gap)
    zpl += '^LL400\n';       // Label length 50mm
    zpl += '^LS0\n';
    zpl += '^MD10\n';
    zpl += '^PR3\n';

    // ── Company header (tiny) ──
    zpl += `^FO6,${y}^A0N,11,11^FDPOPPING BOBA INTL S.A.S.^FS\n`;
    y += 13;
    zpl += `^FO${textX},${y}^GB${W},1,1^FS\n`;
    y += 3;

    // ── Product Name — compact ──
    if (nameLine2) {
        // FLAVOR big
        zpl += `^FO${textX},${y}^A0N,26,26^FD${esc(nameLine2.substring(0, 16))}^FS\n`;
        y += 30;
        if (nameLine3) {
            zpl += `^FO${textX},${y}^A0N,14,14^FD${esc(nameLine3)}^FS\n`;
            y += 18;
        }
    } else {
        zpl += `^FO${textX},${y}^A0N,18,18^FD${esc(nameLine1.substring(0, 22))}^FS\n`;
        y += 22;
    }

    // ── SKU + Lote ──
    zpl += `^FO${textX},${y}^A0N,14,14^FD${esc(sku.substring(0, 10))}  L:${esc(lotDisplay.substring(0, 12))}^FS\n`;
    y += 18;

    // ── Quantity ──
    zpl += `^FO${textX},${y}^A0N,18,18^FD${esc(qtyText.substring(0, 20))}^FS\n`;
    y += 22;

    // ── Dates ──
    zpl += `^FO${textX},${y}^A0N,12,12^FDF:${fabDate} V:${expDate}^FS\n`;
    y += 16;

    // ── Separator ──
    zpl += `^FO${textX},${y}^GB${W},1,1^FS\n`;
    y += 4;

    // ── QR Code — small, left-aligned ──
    // Simplified QR content for smaller code
    const qrData = `${lotNumber}|${sku}|${quantity}`;
    zpl += `^FO${textX},${y}^BQN,2,3^FDMA,${esc(qrData)}^FS\n`;

    // ── Timestamp at very bottom ──
    const now = new Date();
    const ts = `${now.toLocaleDateString('es-CO')}`;
    zpl += `^FO${textX},385^A0N,10,10^FD${ts}^FS\n`;

    // ── Print copies ──
    zpl += `^PQ${copies}\n`;
    zpl += '^XZ\n';

    return zpl;
}

/**
 * Build a test label for Zebra — minimal ZPL
 */
export function buildTestLabelZPL() {
    const now = new Date().toLocaleString('es-CO');
    return [
        '^XA',
        '^MMT',
        '^PW296',        // 37mm width (single label of 2-up)
        '^LL400',
        '^LS0',
        '^MD10',
        '^FO20,60^A0N,32,32^FDTEST^FS',
        '^FO20,100^A0N,18,18^FDZebra ZD230t^FS',
        `^FO20,130^A0N,14,14^FD${now}^FS`,
        '^FO40,180^BQN,2,3^FDMA,PBI-TEST^FS',
        '^PQ1,0,1,Y',
        '^XZ',
    ].join('\n');
}

/**
 * Escape special characters for ZPL strings
 */
function esc(str) {
    if (!str) return '';
    return str
        .replace(/\^/g, '')
        .replace(/~/g, '')
        .replace(/\n/g, ' ')
        .replace(/\r/g, '');
}
