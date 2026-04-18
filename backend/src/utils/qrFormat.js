/**
 * qrFormat.js — Single source of truth for the QR string format.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * STANDARD QR FORMAT (pipe-delimited string):
 *   PKG:{packageId}|LOT:{lot}|SKU:{sku}|BAR:{barcode}|QTY:{qty}|TYP:{containerType}|REC:{yyyy-mm-dd}|EXP:{yyyy-mm-dd}|BOX:{boxNumber}/{totalBoxes}
 *
 * Used by:
 *   - Frontend: qrService.js, zplLabelBuilder.js, tsplLabelBuilder.js
 *   - Backend:  finishedLotRoutes.js (qr-payload endpoint)
 *   - Scanner:  scannerParser.js  (reader/consumer)
 *
 * If the format changes, update THIS file and scannerParser.js ONLY.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * Strip flavor/product prefix from a lot number.
 * Batch numbers are generated as "FLAVOR-YYMMDD-HHMM" (e.g. "ESCARCHADOR-260409-0428").
 * The QR should only contain the numeric date-time code: "260409-0428".
 *
 * @param {string} lotNumber
 * @returns {string} — lot code without flavor prefix
 */
function stripLotPrefix(lotNumber) {
    if (!lotNumber) return '';
    // Match the date-time pattern at the end: YYMMDD-HHMM(SS)(-RND)
    const match = lotNumber.match(/(\d{6}-\d{3,6}(?:-\d+)?)$/);
    return match ? match[1] : lotNumber;
}

/**
 * Build the canonical pipe-delimited QR string.
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

function buildQrString({
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

module.exports = { buildQrString, stripLotPrefix };
