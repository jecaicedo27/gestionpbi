/**
 * qrService.js — Centralized QR payload generation
 *
 * All frontend components should use this service to generate QR data
 * instead of building payloads independently. This ensures consistent
 * QR format across: MarcadoCajasStep, FinishedProductZonePage, QRGeneratorPage, Labeling.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * STANDARD QR FORMAT (pipe-delimited string — same as label builders):
 *   PKG:{packageId}|LOT:{lot}|SKU:{sku}|BAR:{barcode}|QTY:{qty}|TYP:{containerType}|REC:{yyyy-mm-dd}|EXP:{yyyy-mm-dd}|BOX:{boxNumber}/{totalBoxes}
 *
 * This MUST match the format used by:
 *   - zplLabelBuilder.js  (Zebra ZD230t)
 *   - tsplLabelBuilder.js (SAT AF 330)
 *   - scannerParser.js    (reader/consumer)
 * ═══════════════════════════════════════════════════════════════════════
 */

import QRCode from 'qrcode';
import api from './api';

/**
 * Strip flavor/product prefix from a lot number.
 * Batch numbers are generated as "FLAVOR-YYMMDD-HHMM" (e.g. "ESCARCHADOR-260409-0428").
 * The QR should only contain the numeric date-time code: "260409-0428".
 *
 * @param {string} lotNumber
 * @returns {string}
 */
export function stripLotPrefix(lotNumber) {
    if (!lotNumber) return '';
    const match = lotNumber.match(/(\d{6}-\d{3,6}(?:-\d+)?)$/);
    return match ? match[1] : lotNumber;
}

/**
 * Build the canonical pipe-delimited QR string.
 * Single source of truth for the QR text content.
 *
 * @param {object}  p
 * @param {string}  p.lotNumber
 * @param {string}  p.sku
 * @param {string}  p.barcode
 * @param {number}  p.quantity
 * @param {number}  [p.boxNumber=1]
 * @param {number}  [p.totalBoxes=1]
 * @returns {string}
 */
function formatDatePart(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
}

export function buildQrString({
    packageId,
    lotNumber,
    sku,
    barcode,
    quantity,
    containerType,
    receivedAt,
    expiresAt,
    boxNumber = 1,
    totalBoxes = 1
}) {
    const cleanLot = stripLotPrefix(lotNumber);
    const parts = [];

    if (packageId) parts.push(`PKG:${packageId}`);
    if (cleanLot) parts.push(`LOT:${cleanLot}`);
    if (sku) parts.push(`SKU:${sku}`);
    if (barcode || sku) parts.push(`BAR:${barcode || sku}`);
    if (quantity !== undefined && quantity !== null) parts.push(`QTY:${quantity}`);
    if (containerType) parts.push(`TYP:${containerType}`);

    const received = formatDatePart(receivedAt);
    if (received) parts.push(`REC:${received}`);

    const expires = formatDatePart(expiresAt);
    if (expires) parts.push(`EXP:${expires}`);

    parts.push(`BOX:${boxNumber}/${totalBoxes}`);
    return parts.join('|');
}

/**
 * Fetch standardized QR payload from backend.
 *
 * @param {string} productId — Product UUID
 * @param {object} opts
 * @param {string} opts.lotNumber — Lot number
 * @param {number} opts.quantity — Units per box
 * @param {string} [opts.expiresAt] — Expiration date ISO
 * @param {number} [opts.boxNumber] — Current box number
 * @param {number} [opts.totalBoxes] — Total boxes in batch
 * @returns {Promise<{ qrString, product }>}
 */
export async function fetchQrPayload(productId, { lotNumber, quantity, expiresAt, boxNumber, totalBoxes } = {}) {
    const res = await api.get(`/finished-lots/qr-payload/${productId}`, {
        params: { lotNumber, quantity, expiresAt, boxNumber, totalBoxes },
    });
    return res.data;
}

/**
 * Generate QR data URL from the standardized payload.
 * Calls the backend endpoint then generates the QR image client-side.
 *
 * IMPORTANT: The QR encodes the pipe-delimited STRING, NOT a JSON object.
 * This ensures consistency with physical labels printed by ZPL/TSPL builders.
 *
 * @param {string} productId
 * @param {object} opts — { lotNumber, quantity, expiresAt, boxNumber, totalBoxes }
 * @returns {Promise<{ dataUrl, qrString, product }>}
 */
export async function generateQrDataUrl(productId, opts = {}) {
    const data = await fetchQrPayload(productId, opts);

    // Encode the pipe-delimited string — NOT JSON
    const dataUrl = await QRCode.toDataURL(data.qrString, {
        width: 400,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
    });

    return { dataUrl, qrString: data.qrString, product: data.product };
}

/**
 * Build QR payload locally (offline fallback, same format as backend).
 * Use fetchQrPayload when possible for true single-source-of-truth.
 *
 * @param {object}  product — { sku, barcode, name }
 * @param {string}  lotNumber
 * @param {number}  quantity
 * @param {string}  [expiresAt]
 * @param {number}  [boxNumber=1]
 * @param {number}  [totalBoxes=1]
 * @returns {{ qrString: string }}
 */
export function buildQrPayloadLocal(product, lotNumber, quantity, expiresAt, boxNumber = 1, totalBoxes = 1, extras = {}) {
    const qrString = buildQrString({
        packageId: extras.packageId,
        lotNumber,
        sku: product.sku || '',
        barcode: product.barcode || product.sku || '',
        quantity,
        containerType: extras.containerType,
        receivedAt: extras.receivedAt,
        expiresAt,
        boxNumber,
        totalBoxes,
    });
    return { qrString };
}
