/**
 * zplLabelBuilder.js — Generate ZPL commands for Zebra ZD230t
 *
 * Label paper: Dual-column roll
 *   Total width:  103mm = 824 dots (at 8 dots/mm, 203 DPI)
 *   Total height:  40mm = 320 dots
 *   Left column:   50mm = 400 dots (0 → 400)
 *   Center gap:     3mm =  24 dots
 *   Right column:  50mm = 400 dots (424 → 824)
 *
 * Each print produces TWO identical labels side by side.
 */
import { buildQrString } from './qrService';

/**
 * Render one label's content at a given X offset.
 * Fits in ~48mm wide × 38mm tall (384 × 304 dots usable).
 */
function renderLabel(data, xOff, { maquila = false } = {}) {
    const {
        productName = '', sku = '', lotNumber = '',
        quantity = 0, unit = 'unidad',
        receivedAt = '', expiresAt = '',
        barcode = '', boxNumber = 1, totalBoxes = 1,
        statusText = null
    } = data;

    // Format quantity
    const isWeight = unit === 'gramo' || unit === 'g';
    const qtyText = isWeight
        ? `${quantity.toLocaleString('es-CO')} g`
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
    if (maquila) {
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
            // Non-SABOR products (e.g. "SIROPE GENIALITY ESCARCHADOR X 360 ML" or "PREMEZCLA GOMAS PARA PERLAS")
            const sizeMatch = productName.match(/^(.+?)(\s+X\s+\d+.*)$/i);
            if (sizeMatch) {
                const base = sizeMatch[1].trim();
                nameLine3 = sizeMatch[2].trim();
                // Try to split known brands from product variant
                const brandMatch = base.match(/^(SIROPE GENIALITY|LIQUIPOPS|ESSKISIMO|BLACK|WOW|BATCH GENIALITY)\s+(.+)$/i);
                if (brandMatch) {
                    nameLine1 = brandMatch[1].trim();
                    nameLine2 = brandMatch[2].trim();
                } else {
                    nameLine1 = base.substring(0, 24);
                }
            } else {
                // No size spec — split long names (e.g. premixes) into 2 lines
                const words = productName.split(/\s+/);
                if (words.length >= 3 && productName.length > 16) {
                    // Split roughly in half at a word boundary
                    const mid = Math.ceil(words.length / 2);
                    nameLine1 = words.slice(0, mid).join(' ');
                    nameLine2 = words.slice(mid).join(' ');
                } else {
                    nameLine1 = productName.substring(0, 24);
                }
            }
        }
    }

    // Lot display (shortened)
    let lotDisplay = lotNumber;
    if (/[a-zA-Z]/.test(lotNumber)) {
        const parts = lotNumber.split('-');
        lotDisplay = parts.length >= 2 ? parts.slice(-2).join('-') : parts[parts.length - 1];
    }
    if (lotDisplay.length > 18) lotDisplay = lotDisplay.substring(0, 18) + '..';

    // QR content — canonical format from qrService (single source of truth)
    const qrData = buildQrString({ lotNumber, sku, barcode: barcode || sku, quantity, boxNumber, totalBoxes });

    // ── Build label fields at xOff ──
    // Column: ~50mm = 400 dots wide, 40mm = 320 dots tall
    // Layout mirrors SAT label: text LEFT, separator, QR RIGHT
    const x = xOff + 14;      // left margin ~1.7mm to avoid cut-off
    const sepX = xOff + 236;
    const qrX = xOff + 244;
    let y = 14;                // ~1.7mm top margin
    let fields = '';

    // ── 1. Company header (small, like SAT) ──
    if (statusText) {
        // Print inverted black box with white text for status
        fields += `^FO${x},${y - 2}^GB380,22,22^FS\n`;
        fields += `^FO${x + 10},${y + 2}^A0N,16,14^FR^FD${esc(statusText)}^FS\n`;
    } else if (!maquila) {
        fields += `^FO${x},${y}^A0N,16,14^FDPOPPING BOBA INTL S.A.S.^FS\n`;
    }
    if (statusText || !maquila) {
        y += 18;
        fields += `^FO${x},${y}^GB380,1,1^FS\n`;
        y += 3;
    }

    // ── LEFT SIDE: Same order as SAT label ──

    // 2. Brand line — smart abbreviation to fit 50mm column
    if (nameLine2) {
        let brandLine = nameLine1;
        // Shorten known brands to fit label width (~16 chars at 18pt)
        if (/SIROPE GENIALITY/i.test(brandLine))        brandLine = 'GENIALITY SABOR';
        else if (/LIQUIPOPS/i.test(brandLine))           brandLine = 'LIQUIPOPS SABOR';
        else if (/ESSKISIMO/i.test(brandLine))           brandLine = 'ESSKISIMO SABOR';
        else if (/BLACK/i.test(brandLine))               brandLine = 'BLACK SABOR';
        else if (/WOW/i.test(brandLine))                 brandLine = 'WOW SABOR';
        else                                             brandLine = brandLine.substring(0, 18);
        fields += `^FO${x},${y}^A0N,18,16^FD${esc(brandLine)}^FS\n`;
        y += 22;
    }

    // 3. FLAVOR — dynamic sizing based on length
    if (nameLine2) {
        const fl = nameLine2.length;
        if (fl <= 9) {
            // Short: BIG (e.g. "MARACUYA", "CHAMOY")
            fields += `^FO${x},${y}^A0N,44,42^FD${esc(nameLine2)}^FS\n`;
            y += 48;
        } else if (fl <= 16) {
            // Medium: slightly smaller (e.g. "MANGO BICHE", "CEREZA ACIDA")
            fields += `^FO${x},${y}^A0N,34,30^FD${esc(nameLine2)}^FS\n`;
            y += 38;
        } else {
            // Long: 2 lines (e.g. "MANGO BICHE CON SAL")
            const mid = nameLine2.lastIndexOf(' ', 14);
            const splitAt = mid > 4 ? mid : 14;
            fields += `^FO${x},${y}^A0N,28,26^FD${esc(nameLine2.substring(0, splitAt))}^FS\n`;
            y += 30;
            fields += `^FO${x},${y}^A0N,28,26^FD${esc(nameLine2.substring(splitAt).trim())}^FS\n`;
            y += 32;
        }
    } else {
        // Single-line name: use dynamic sizing based on length
        const len = nameLine1.length;
        if (len <= 14) {
            fields += `^FO${x},${y}^A0N,36,34^FD${esc(nameLine1)}^FS\n`;
            y += 40;
        } else if (len <= 20) {
            fields += `^FO${x},${y}^A0N,28,26^FD${esc(nameLine1)}^FS\n`;
            y += 32;
        } else {
            fields += `^FO${x},${y}^A0N,22,20^FD${esc(nameLine1.substring(0, 24))}^FS\n`;
            y += 26;
        }
    }

    // 4. Size spec "X 3400 GR"
    if (nameLine3) {
        fields += `^FO${x},${y}^A0N,20,18^FD${esc(nameLine3.substring(0, 14))}^FS\n`;
        y += 22;
    }

    // 5. SKU
    if (!maquila) {
        fields += `^FO${x},${y}^A0N,20,18^FDSKU: ${esc(sku.substring(0, 12))}^FS\n`;
        y += 22;
    }

    // 6. Lote — FULL number, no truncation
    fields += `^FO${x},${y}^A0N,20,18^FDLote: ${esc(lotDisplay.substring(0, 16))}^FS\n`;
    y += 24;

    // 7. Quantity — bold
    fields += `^FO${x},${y}^A0N,30,30^FD${esc(qtyText.substring(0, 12))}^FS\n`;
    y += 34;

    // 8. Dates
    fields += `^FO${x},${y}^A0N,18,16^FDFab: ${fabDate}^FS\n`;
    y += 20;
    fields += `^FO${x},${y}^A0N,18,16^FDVence: ${expDate}^FS\n`;
    y += 20;

    // 9. Timestamp (bottom, tiny — like SAT)
    const now = new Date();
    const ts = `${now.toLocaleDateString('es-CO')} ${now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`;
    fields += `^FO${x},${y}^A0N,12,12^FD${ts}^FS\n`;

    // ── VERTICAL SEPARATOR ──
    fields += `^FO${sepX},20^GB2,290,2^FS\n`;

    // ── RIGHT SIDE: QR Code ──
    fields += `^FO${qrX},30^BQN,2,4^FDMA,${esc(qrData)}^FS\n`;

    return fields;
}

/**
 * Build ZPL for a material lot label — prints TWO copies side-by-side.
 *
 * @param {Object} data  — label data
 * @param {number} [copies=1] — number of PAIRS to print
 * @returns {string} ZPL command string
 */
export function buildLotLabelZPL(data, copies = 1, { maquila = false } = {}) {
    let zpl = '^XA\n';
    zpl += '^MMT\n';          // Thermal transfer mode
    zpl += '^PW824\n';        // Full print width: 103mm = 824 dots
    zpl += '^LL320\n';        // Label length: 40mm = 320 dots
    zpl += '^LS0\n';
    zpl += '^MD10\n';
    zpl += '^PR3\n';
    
    // Left label (column 1): starts at X=0
    zpl += renderLabel(data, 0, { maquila });

    // Right label (column 2): starts at X=424 (50mm + 3mm gap = 53mm = 424 dots)
    zpl += renderLabel(data, 424, { maquila });

    // Print pairs
    zpl += `^PQ${copies}\n`;
    zpl += '^XZ\n';

    return zpl;
}

/**
 * Build a test label for Zebra — dual column
 */
export function buildTestLabelZPL() {
    const now = new Date().toLocaleString('es-CO');
    return [
        '^XA',
        '^MMT',
        '^PW824',        // Full 103mm width
        '^LL320',        // 40mm height
        '^LS0',
        '^MD10',
        // Left test
        '^FO20,20^A0N,28,28^FDTEST IZQ^FS',
        `^FO20,60^A0N,14,14^FD${now}^FS`,
        '^FO20,90^BQN,2,2^FDMA,PBI-L^FS',
        // Right test
        '^FO444,20^A0N,28,28^FDTEST DER^FS',
        `^FO444,60^A0N,14,14^FD${now}^FS`,
        '^FO444,90^BQN,2,2^FDMA,PBI-R^FS',
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

/**
 * Render one carrito label at a given X offset.
 * Same physical dimensions (50mm wide x 40mm tall) but focused on Carrito routing.
 */
function renderCarritoLabel(data, xOff) {
    const {
        carritoId = '',
        productName = '',
        lotNumber = '',
        quantity = 0,
        unit = 'unidad',
        totalBoxes = 1,
        boxNumber = 1
    } = data;

    const qtyText = (unit === 'kg' || unit === 'gramo' || unit === 'g')
        ? `${quantity.toLocaleString('es-CO')} ${unit}`
        : `${quantity.toLocaleString('es-CO')} ${unit || 'und'}`;

    const x = xOff + 14;
    const sepX = xOff + 236;
    const qrX = xOff + 244;
    let y = 14;
    let fields = '';

    // 1. Header (Inverted for visibility)
    fields += `^FO${x},${y - 2}^GB380,22,22^FS\n`;
    fields += `^FO${x + 10},${y + 2}^A0N,16,14^FR^FDIDENTIFICADOR DE CARRITO^FS\n`;
    y += 24;
    
    // 2. Carrito ID (HUGE)
    fields += `^FO${x},${y}^A0N,44,40^FD${esc(String(carritoId).substring(0, 8).toUpperCase())}^FS\n`;
    y += 50;

    // 3. Product Destino
    let shortName = productName.replace(/.*SABOR A\s?/i, '').replace(/X\s*\d+.*$/i, '').trim() || productName.substring(0, 18);
    if (shortName.length > 20) shortName = shortName.substring(0, 20);
    fields += `^FO${x},${y}^A0N,22,22^FD${esc(shortName)}^FS\n`;
    y += 30;

    // 4. Lote and Qty
    fields += `^FO${x},${y}^A0N,20,18^FDLote: ${esc(lotNumber)}^FS\n`;
    y += 24;
    fields += `^FO${x},${y}^A0N,30,28^FD${esc(qtyText)}^FS\n`;
    y += 34;

    // 5. Sequence
    fields += `^FO${x},${y}^A0N,18,16^FDCart ${boxNumber} de ${totalBoxes}^FS\n`;

    // 6. Vertical separator
    fields += `^FO${sepX},20^GB2,290,2^FS\n`;

    // 7. QR Code (using canonical data structure for carritos if needed, or simple lot QR)
    const qrData = JSON.stringify({ cart: carritoId, lot: lotNumber, qty: quantity });
    fields += `^FO${qrX},30^BQN,2,4^FDMA,${esc(qrData)}^FS\n`;

    return fields;
}

/**
 * Build ZPL for a carrito tag. Prints ONE tag on the left column.
 */
export function buildCarritoLabelZPL(data) {
    let zpl = '^XA\n';
    zpl += '^MMT\n';
    zpl += '^PW824\n';        // Full print width: 103mm = 824 dots
    zpl += '^LL320\n';        // Label length: 40mm = 320 dots
    zpl += '^LS0\n';
    zpl += '^MD10\n';
    zpl += '^PR3\n';

    zpl += renderCarritoLabel(data, 0); // Only print left side

    zpl += '^PQ1\n';
    zpl += '^XZ\n';

    return zpl;
}
