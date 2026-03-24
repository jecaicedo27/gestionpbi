/**
 * qrService.js — Centralized QR payload generation
 *
 * All frontend components should use this service to generate QR data
 * instead of building payloads independently. This ensures consistent
 * QR format across: MarcadoCajasStep, FinishedProductZonePage, QRGeneratorPage, Labeling.
 *
 * QR String format: LOT:{lot}|SKU:{sku}|BAR:{barcode}|QTY:{qty}
 */

import QRCode from 'qrcode';
import api from './api';

/**
 * Fetch standardized QR payload from backend.
 *
 * @param {string} productId — Product UUID
 * @param {object} opts
 * @param {string} opts.lotNumber — Lot number
 * @param {number} opts.quantity — Units per box
 * @param {string} [opts.expiresAt] — Expiration date ISO
 * @returns {Promise<{ qrPayload, qrString, product }>}
 */
export async function fetchQrPayload(productId, { lotNumber, quantity, expiresAt } = {}) {
    const res = await api.get(`/finished-lots/qr-payload/${productId}`, {
        params: { lotNumber, quantity, expiresAt },
    });
    return res.data;
}

/**
 * Generate QR data URL from the standardized payload.
 * Calls the backend endpoint then generates the QR image client-side.
 *
 * @param {string} productId
 * @param {object} opts — { lotNumber, quantity, expiresAt }
 * @returns {Promise<{ dataUrl, qrPayload, qrString, product }>}
 */
export async function generateQrDataUrl(productId, opts = {}) {
    const data = await fetchQrPayload(productId, opts);

    const dataUrl = await QRCode.toDataURL(JSON.stringify(data.qrPayload), {
        width: 400,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
    });

    return { dataUrl, ...data };
}

/**
 * Build QR payload locally (offline fallback, same format as backend).
 * Use fetchQrPayload when possible for true single-source-of-truth.
 *
 * @param {object} product — { sku, barcode, name }
 * @param {string} lotNumber
 * @param {number} quantity
 * @param {string} [expiresAt]
 * @returns {{ qrPayload, qrString }}
 */
export function buildQrPayloadLocal(product, lotNumber, quantity, expiresAt) {
    const barcode = product.barcode || product.sku || '';
    const qrPayload = {
        productCode: product.sku || '',
        barcode,
        name: product.name || '',
        lot: lotNumber,
        lotNumber,
        unitsPerBox: quantity,
        expirationDate: expiresAt || '',
    };
    const qrString = `LOT:${lotNumber}|SKU:${product.sku || ''}|BAR:${barcode}|QTY:${quantity}`;
    return { qrPayload, qrString };
}
