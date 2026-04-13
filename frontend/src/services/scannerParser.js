/**
 * scannerParser.js — Centralized scanner input parser
 *
 * Understands three input formats from barcode/QR scanners:
 *
 * 1. JSON (from MarcadoCajas / empaque QR labels):
 *    {"productCode":"LIQD14","barcode":"7789...","lotNumber":"260317-1301",...}
 *
 * 2. LOT:SKU (from tsplLabelBuilder / thermal printer labels):
 *    LOT:13070976|SKU:LIQD14
 *
 * 3. Plain barcode (numeric EAN/UPC from barcode gun):
 *    7789987546329
 *
 * Returns a normalized result object regardless of input format.
 */

/**
 * @typedef {Object} ScanResult
 * @property {'qr_json'|'qr_lot_sku'|'barcode'|'unknown'} type
 * @property {string|null} sku        - Product SKU (productCode)
 * @property {string|null} barcode    - EAN/UPC barcode
 * @property {string|null} lotNumber  - Lot/batch number
 * @property {string|null} name       - Product name (if available)
 * @property {number|null} unitsPerBox - Units per box (if available)
 * @property {string|null} expirationDate - Expiry date (if available)
 * @property {string}      raw        - Original raw input
 */

/**
 * Parse raw scanner input into a normalized object.
 * @param {string} rawValue - Raw string from scanner
 * @returns {ScanResult}
 */
export function parseScanInput(rawValue) {
    if (!rawValue || typeof rawValue !== 'string') {
        return { type: 'unknown', sku: null, barcode: null, lotNumber: null, name: null, unitsPerBox: null, expirationDate: null, raw: '' };
    }

    let buffer = rawValue.trim();
    if (buffer.length < 4) {
        return { type: 'unknown', sku: null, barcode: null, lotNumber: null, name: null, unitsPerBox: null, expirationDate: null, raw: buffer };
    }

    // ── 0. Fix Reversed Inputs (from BT scanners on specific tablets) ──
    if (buffer.includes(':TOL') || buffer.includes(':UKS')) {
        buffer = buffer.split('').reverse().join('');
    }

    // ── 1. Try JSON (MarcadoCajas / empaque QR) ──
    if (buffer.startsWith('{')) {
        try {
            const data = JSON.parse(buffer);
            if (data.productCode || data.sku) {
                return {
                    type: 'qr_json',
                    sku: data.productCode || data.sku || null,
                    barcode: data.barcode || null,
                    lotNumber: data.lotNumber || data.lot || null,
                    name: data.name || null,
                    unitsPerBox: data.unitsPerBox ? parseInt(data.unitsPerBox) : null,
                    expirationDate: data.expirationDate || null,
                    raw: buffer,
                };
            }
        } catch {
            // Not valid JSON — fall through
        }
    }

    // ── 2. Try LOT:xxx|SKU:xxx|BAR:xxx|QTY:xxx|BOX:x/x (tsplLabelBuilder / thermal labels) ──
    if (buffer.includes('LOT:') || buffer.includes('SKU:')) {
        const parts = buffer.split('|');
        const lotPart  = parts.find(p => p.startsWith('LOT:'));
        const skuPart  = parts.find(p => p.startsWith('SKU:'));
        const barPart  = parts.find(p => p.startsWith('BAR:'));
        const qtyPart  = parts.find(p => p.startsWith('QTY:'));
        const boxPart  = parts.find(p => p.startsWith('BOX:'));

        if (lotPart || skuPart) {
            const qty = qtyPart ? parseInt(qtyPart.replace('QTY:', '').trim(), 10) : null;
            // Parse BOX:1/5 → boxNumber=1, totalBoxes=5
            let boxNumber = null, totalBoxes = null;
            if (boxPart) {
                const boxVal = boxPart.replace('BOX:', '').trim();
                const boxMatch = boxVal.match(/^(\d+)\/(\d+)$/);
                if (boxMatch) {
                    boxNumber = parseInt(boxMatch[1], 10);
                    totalBoxes = parseInt(boxMatch[2], 10);
                }
            }
            return {
                type: 'qr_lot_sku',
                sku: skuPart ? skuPart.replace('SKU:', '').trim() : null,
                barcode: barPart ? barPart.replace('BAR:', '').trim() : null,
                lotNumber: lotPart ? lotPart.replace('LOT:', '').trim() : null,
                name: null,
                unitsPerBox: (!isNaN(qty) && qty > 0) ? qty : null,
                boxNumber,
                totalBoxes,
                expirationDate: null,
                raw: buffer,
            };
        }
    }

    // ── 3. Plain barcode (numeric string, typically EAN-13/UPC) ──
    return {
        type: 'barcode',
        sku: null,
        barcode: buffer,
        lotNumber: null,
        name: null,
        unitsPerBox: null,
        expirationDate: null,
        raw: buffer,
    };
}
