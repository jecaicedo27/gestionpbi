import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { Printer, Package, RefreshCw } from 'lucide-react';

/**
 * MarcadoCajasStep
 *
 * Auto-fills product/lot/expiry from the assembly note.
 * Calculates units-per-box from the CAJA item in note.items.
 * Generates QR on mount and allows the operator to print the label.
 * Calls onMarcadoChange so the wizard can save the box data on SIGUIENTE.
 */
const MarcadoCajasStep = ({ stepData, onMarcadoChange, allBatchNotes = [] }) => {
    const noteData = stepData;

    // ── Derive data from note ────────────────────────────────────────────────
    const product = noteData.product || {};
    const batchNumber = noteData.productionBatch?.batchNumber || noteData.noteNumber || '';

    // Units-per-box: use product's packPerBox config, then fallback to CAJA item, then 1
    const cajaItem = (noteData.items || []).find(i =>
        i.component?.name?.toUpperCase().includes('CAJA')
    );
    const defaultUnitsPerBox = product.packPerBox
        || (cajaItem?.plannedQuantity ? Math.round(1 / cajaItem.plannedQuantity) : 1);

    // Total units: from output targets (final products) or targetQuantity (intermediate)
    const outputTargets = noteData.productionBatch?.outputTargets || [];
    const stageName = (noteData.stageName || '').toLowerCase();
    const nums = (stageName.match(/\d{3,}/g) || []);
    const matchedTarget = outputTargets.find(t =>
        nums.some(n => (t.product?.name || '').toLowerCase().includes(n))
    ) || (outputTargets.length === 1 ? outputTargets[0] : null);

    // Detect if this is a weight-based intermediate product (BASE, COMPUESTO, etc.)
    const isWeightBased = !matchedTarget?.plannedUnits;
    const totalTarros = (() => {
        // Prioritize note's targetQuantity (updated by post-CONTEO with actual counts)
        if (noteData.targetQuantity && noteData.targetQuantity < 50000) return noteData.targetQuantity;
        // Fallback: planned units from output targets
        if (matchedTarget?.plannedUnits) return matchedTarget.plannedUnits;
        // For intermediate products (BASE, COMPUESTO): sum of item quantities = scaled value
        if (isWeightBased && noteData.items?.length > 0) {
            const weightUnits = ['g', 'kg', 'gramo', 'gramos'];
            const total = noteData.items.reduce((sum, item) => {
                if (!weightUnits.includes(item.unit)) return sum;
                const qty = item.plannedQuantity || 0;
                return sum + ((item.unit === 'kg') ? qty * 1000 : qty);
            }, 0);
            if (total > 0) return Math.round(total);
        }
        return noteData.targetQuantity || 0;
    })();
    const metaLabel = isWeightBased ? 'gramos' : 'unidades';

    // Expiry: 9 months from now
    const expiryDate = (() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 9);
        return d.toISOString().split('T')[0];
    })();

    // ── Local state ──────────────────────────────────────────────────────────
    const [unitsPerBox, setUnitsPerBox] = useState(defaultUnitsPerBox);
    const [qrDataUrl, setQrDataUrl] = useState('');
    const [printed, setPrinted] = useState(false);

    const totalBoxes = unitsPerBox > 0 ? Math.ceil(totalTarros / unitsPerBox) : 0;

    // Notify wizard whenever boxes data changes
    useEffect(() => {
        onMarcadoChange?.({ unidadesPorCaja: unitsPerBox, totalCajas: totalBoxes });
    }, [unitsPerBox, totalBoxes, onMarcadoChange]);

    // ── QR generation ────────────────────────────────────────────────────────
    const generateQR = useCallback(async () => {
        const qrPayload = {
            productCode: product.sku || '',
            barcode: product.barcode || product.sku || '',
            name: product.name || '',
            lot: batchNumber,
            lotNumber: batchNumber,
            unitsPerBox,
            totalBoxes,
            expirationDate: expiryDate,
        };
        try {
            const url = await QRCode.toDataURL(JSON.stringify(qrPayload), {
                width: 400, margin: 2,
                color: { dark: '#000000', light: '#FFFFFF' }
            });
            setQrDataUrl(url);
        } catch (e) {
            console.error('QR error:', e);
        }
    }, [product.sku, product.barcode, product.name, batchNumber, unitsPerBox, totalBoxes, expiryDate]);

    useEffect(() => { generateQR(); }, [generateQR]);

    // ── Print ─────────────────────────────────────────────────────────────────
    const handlePrint = () => {
        if (!qrDataUrl) return;
        const flavor = (product.name || '').replace(/LIQUIPOPS SABOR A?\s*/i, '').replace(/X\s*\d+/i, '').trim();
        const size = (product.name || '').match(/\d{3,4}\s*GR/i)?.[0] || '';
        const formattedExpiry = new Date(expiryDate).toLocaleDateString('es-CO', {
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).replace(/\//g, '-');

        const printWindow = window.open('', '_blank');
        printWindow.document.write(`<!DOCTYPE html>
<html><head>
<title>Rótulo — ${product.name}</title>
<style>
@page { size: 50mm 40mm; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: 50mm; height: 40mm; font-family: Arial, sans-serif; background: white; padding: 1.5mm; }
.label { width: 100%; height: 100%; display: flex; flex-direction: column; }
.product-name { font-size: 8pt; font-weight: bold; line-height: 1.1; text-align: center; margin-bottom: 0.5mm; text-transform: uppercase; }
.product-footer { font-size: 10pt; font-weight: bold; text-align: center; margin-top: 1mm; line-height: 1; text-transform: uppercase; }
.content { flex: 1; display: flex; gap: 1.5mm; }
.qr-section { flex-shrink: 0; width: 26mm; display: flex; align-items: center; justify-content: center; }
.qr-image { width: 26mm; height: 26mm; image-rendering: pixelated; image-rendering: crisp-edges; }
.info-section { flex: 1; display: flex; flex-direction: column; justify-content: flex-start; font-size: 6pt; line-height: 1.15; padding-top: 1mm; }
.info-top { margin-bottom: 2mm; }
.barcode-text { font-size: 8pt; font-weight: bold; margin-bottom: 0.8mm; }
.lot-line { font-size: 7pt; margin-bottom: 0.5mm; }
.lot-number { font-weight: bold; }
.expiry-line { font-size: 5.5pt; }
.quantity-box { border: 1.5px solid #000; padding: 1mm 2mm; text-align: center; font-weight: bold; font-size: 7.5pt; line-height: 1; display: inline-block; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="label">
  <div class="product-name">MATERIA PRIMA SABORES</div>
  <div class="content">
    <div class="qr-section"><img src="${qrDataUrl}" class="qr-image" alt="QR" /></div>
    <div class="info-section">
      <div class="info-top">
        <div class="barcode-text">${product.sku || ''}</div>
        <div class="lot-line">Lote: <span class="lot-number">${batchNumber}</span></div>
        <div class="expiry-line">Vence: ${formattedExpiry}</div>
      </div>
      <div class="quantity-box">CANT: ${unitsPerBox}</div>
    </div>
  </div>
  <div class="product-footer">${flavor} ${size}</div>
</div>
</body></html>`);
        printWindow.document.close();
        setTimeout(() => {
            printWindow.print();
            setPrinted(true);
        }, 500);
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-8 pb-36 px-4">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold text-2xl shadow-md">
                    📦
                </div>
                <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                    MARCADO DE CAJAS
                </div>
            </div>

            {/* Card */}
            <div className="bg-white rounded-3xl shadow-2xl border-4 border-orange-400 overflow-hidden flex-1 flex flex-col animate-in slide-in-from-right-8 duration-300">
                <div className="bg-gradient-to-r from-orange-500 to-amber-400 p-4 text-center">
                    <span className="text-white font-extrabold text-lg uppercase tracking-widest">
                        📦 ROTULADO DE CAJAS
                    </span>
                </div>

                <div className="flex-1 flex flex-col lg:flex-row gap-6 p-6">
                    {/* Left: data + controls */}
                    <div className="flex-1 space-y-4">
                        <h2 className="text-xl font-black text-slate-800">{product.name}</h2>

                        {/* Summary cards */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-orange-50 rounded-2xl p-3 text-center border border-orange-200">
                                <div className="text-xs text-orange-500 font-bold uppercase mb-1">Meta</div>
                                <div className="text-2xl font-black text-orange-700">{Number(totalTarros).toLocaleString('es-CO')}</div>
                                <div className="text-xs text-orange-400 mt-0.5">{metaLabel}</div>
                            </div>
                            <div className="bg-amber-50 rounded-2xl p-3 text-center border border-amber-200">
                                <div className="text-xs text-amber-600 font-bold uppercase mb-1">Unidad</div>
                                <div className="text-2xl font-black text-amber-700">1</div>
                                <div className="text-xs text-amber-400 mt-0.5">producto fabricado</div>
                            </div>
                        </div>

                        {/* Lot info */}
                        <div className="bg-slate-50 rounded-2xl p-4 space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-slate-500 font-medium">Lote:</span>
                                <span className="font-black text-slate-800">{batchNumber}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500 font-medium">SKU:</span>
                                <span className="font-mono text-slate-700">{product.sku}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500 font-medium">Vence:</span>
                                <span className="text-slate-700">{new Date(expiryDate).toLocaleDateString('es-CO')}</span>
                            </div>
                        </div>

                        {/* Buttons */}
                        <div className="flex gap-3">
                            <button
                                onClick={handlePrint}
                                disabled={!qrDataUrl}
                                className="flex-1 flex items-center justify-center gap-2 py-4 px-6 bg-orange-500 hover:bg-orange-600 text-white font-black rounded-2xl shadow-lg transition-all text-lg disabled:opacity-40"
                            >
                                <Printer size={22} />
                                {printed ? '✅ Imprimir de nuevo' : 'Imprimir Rótulo'}
                            </button>
                            <button
                                onClick={generateQR}
                                className="p-4 bg-slate-100 hover:bg-slate-200 rounded-2xl transition-all"
                                title="Regenerar QR"
                            >
                                <RefreshCw size={20} className="text-slate-500" />
                            </button>
                        </div>

                        {printed && (
                            <div className="text-center text-green-600 font-bold text-sm animate-pulse">
                                ✅ Rótulo impreso — presiona SIGUIENTE para continuar
                            </div>
                        )}
                    </div>

                    {/* Right: QR preview */}
                    <div className="flex flex-col items-center justify-center gap-4 lg:w-72">
                        {qrDataUrl ? (
                            <div className="border-2 border-dashed border-slate-300 rounded-2xl p-4 bg-slate-50"
                                style={{ width: 260, height: 208 }}>
                                {/* Mini label preview */}
                                <div className="flex flex-col h-full">
                                    <div className="font-bold text-center uppercase text-xs mb-1 text-slate-600">
                                        MATERIA PRIMA SABORES
                                    </div>
                                    <div className="flex gap-2 flex-1">
                                        <img src={qrDataUrl} alt="QR" style={{ width: 100, height: 100 }}
                                            className="object-contain flex-shrink-0" />
                                        <div className="flex-1 flex flex-col text-xs">
                                            <div className="font-bold text-slate-800">{product.sku}</div>
                                            <div className="text-slate-600">Lote: <b>{batchNumber}</b></div>
                                            <div className="text-slate-500 text-xs">
                                                Vence: {new Date(expiryDate).toLocaleDateString('es-CO')}
                                            </div>
                                            <div className="mt-2 border-2 border-black px-2 py-0.5 text-xs font-bold inline-block w-fit">
                                                CANT: {unitsPerBox}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="font-bold text-center text-xs mt-1 uppercase text-slate-700">
                                        {(product.name || '').replace(/LIQUIPOPS SABOR A?\s*/i, '').replace(/X\s*\d+/i, '').trim()}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center w-64 h-52 rounded-2xl bg-slate-100">
                                <Package size={48} className="text-slate-300" />
                            </div>
                        )}
                        <p className="text-xs text-slate-400 text-center">
                            Vista previa 50mm × 40mm
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MarcadoCajasStep;
