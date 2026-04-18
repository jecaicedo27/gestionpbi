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
const baseResult = (raw = '') => ({
    type: 'unknown',
    sku: null,
    barcode: null,
    lotNumber: null,
    name: null,
    unitsPerBox: null,
    quantity: null,
    expirationDate: null,
    receivedAt: null,
    packageId: null,
    packageCode: null,
    containerType: null,
    boxNumber: null,
    totalBoxes: null,
    raw,
});

const normalizePositiveQuantity = (value) => {
    if (value == null || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return Math.round(numeric);
};

const SCAN_TYPES_WITH_PACK_FALLBACK = new Set([
    'qr_json',
    'qr_lot_sku',
    'qr_package_label'
]);

const normalizeDatePart = (value) => {
    if (!value) return null;
    const clean = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    const plainMatch = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (plainMatch) return `${plainMatch[1]}-${plainMatch[2]}-${plainMatch[3]}`;
    const parsed = new Date(clean);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
};

export function parseScanInput(rawValue) {
    if (!rawValue || typeof rawValue !== 'string') {
        return baseResult('');
    }

    let buffer = rawValue.trim();
    if (buffer.length < 4) {
        return baseResult(buffer);
    }

    // ── 0. Fix Reversed Inputs (from BT scanners on specific tablets) ──
    if (
        buffer.includes(':TOL') ||
        buffer.includes(':UKS') ||
        buffer.includes(':GKP') ||
        buffer.includes(':RAB') ||
        buffer.includes(':YTQ') ||
        buffer.includes(':XOB') ||
        buffer.includes(':CER') ||
        buffer.includes(':PXE')
    ) {
        buffer = buffer.split('').reverse().join('');
    }

    const normalizedBuffer = buffer.replace(/Ñ/g, ':');

    // ── 1. Try JSON (MarcadoCajas / empaque QR) ──
    if (normalizedBuffer.startsWith('{')) {
        try {
            const data = JSON.parse(normalizedBuffer);
            if (data.productCode || data.sku || data.packageId || data.packageCode) {
                return {
                    ...baseResult(normalizedBuffer),
                    type: 'qr_json',
                    sku: data.productCode || data.sku || null,
                    barcode: data.barcode || null,
                    lotNumber: data.lotNumber || data.lot || null,
                    name: data.name || null,
                    unitsPerBox: data.unitsPerBox ? parseInt(data.unitsPerBox, 10) : (data.quantity ? parseInt(data.quantity, 10) : null),
                    quantity: data.quantity ? parseInt(data.quantity, 10) : (data.unitsPerBox ? parseInt(data.unitsPerBox, 10) : null),
                    expirationDate: normalizeDatePart(data.expirationDate || data.expiresAt),
                    receivedAt: normalizeDatePart(data.receivedAt),
                    packageId: data.packageId || data.packageCode || null,
                    packageCode: data.packageCode || data.packageId || null,
                    containerType: data.containerType || null,
                    boxNumber: data.boxNumber ? parseInt(data.boxNumber, 10) : null,
                    totalBoxes: data.totalBoxes ? parseInt(data.totalBoxes, 10) : null,
                };
            }
        } catch {
            // Not valid JSON — fall through
        }
    }

    // ── 2. Try PKG/LOT/SKU/BAR/QTY/TYP/REC/EXP/BOX payloads ──
    if (
        normalizedBuffer.includes('PKG:') ||
        normalizedBuffer.includes('LOT:') ||
        normalizedBuffer.includes('SKU:') ||
        normalizedBuffer.includes('BAR:') ||
        normalizedBuffer.includes('QTY:')
    ) {
        const parts = normalizedBuffer.split('|');
        const pkgPart  = parts.find(p => p.startsWith('PKG:'));
        const lotPart  = parts.find(p => p.startsWith('LOT:'));
        const skuPart  = parts.find(p => p.startsWith('SKU:') || p.startsWith('R:'));
        const barPart  = parts.find(p => p.startsWith('BAR:'));
        const qtyPart  = parts.find(p => p.startsWith('QTY:'));
        const typPart  = parts.find(p => p.startsWith('TYP:'));
        const recPart  = parts.find(p => p.startsWith('REC:'));
        const expPart  = parts.find(p => p.startsWith('EXP:'));
        const boxPart  = parts.find(p => p.startsWith('BOX:'));

        if (pkgPart || lotPart || skuPart) {
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
                ...baseResult(normalizedBuffer),
                type: pkgPart ? 'qr_package_label' : 'qr_lot_sku',
                sku: skuPart ? skuPart.replace('SKU:', '').replace('R:', '').trim() : null,
                barcode: barPart ? barPart.replace('BAR:', '').trim() : null,
                lotNumber: lotPart ? lotPart.replace('LOT:', '').trim() : null,
                name: null,
                unitsPerBox: (!isNaN(qty) && qty > 0) ? qty : null,
                quantity: (!isNaN(qty) && qty > 0) ? qty : null,
                packageId: pkgPart ? pkgPart.replace('PKG:', '').trim() : null,
                packageCode: pkgPart ? pkgPart.replace('PKG:', '').trim() : null,
                containerType: typPart ? typPart.replace('TYP:', '').trim() : null,
                receivedAt: normalizeDatePart(recPart ? recPart.replace('REC:', '').trim() : null),
                boxNumber,
                totalBoxes,
                expirationDate: normalizeDatePart(expPart ? expPart.replace('EXP:', '').trim() : null),
            };
        }
    }

    // ── 3. Plain barcode (numeric string, typically EAN-13/UPC) ──
    return {
        ...baseResult(buffer),
        type: 'barcode',
        barcode: buffer,
    };
}

export function resolveScannedQuantity({
    scan = null,
    product = null,
    packageLabel = null,
    fallback = null
} = {}) {
    const explicitQuantity = normalizePositiveQuantity(
        packageLabel?.quantity ?? scan?.quantity ?? scan?.unitsPerBox
    );
    if (explicitQuantity) return explicitQuantity;

    const packSize = normalizePositiveQuantity(product?.packSize);
    const hasStructuredPackagingSignal = Boolean(
        packageLabel?.packageCode ||
        packageLabel?.packageId ||
        scan?.packageCode ||
        scan?.packageId ||
        scan?.lotNumber ||
        SCAN_TYPES_WITH_PACK_FALLBACK.has(scan?.type)
    );

    if (hasStructuredPackagingSignal && packSize && packSize > 1) {
        return packSize;
    }

    return normalizePositiveQuantity(fallback);
}
