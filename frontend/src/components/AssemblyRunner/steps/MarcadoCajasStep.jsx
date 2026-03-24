import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { Printer, Package, RefreshCw, Bluetooth, BluetoothOff } from 'lucide-react';
import printer from '../../../services/bluetoothPrinter';
import { buildLotLabel } from '../../../services/tsplLabelBuilder';
import { generateQrDataUrl, buildQrPayloadLocal } from '../../../services/qrService';

/**
 * MarcadoCajasStep
 *
 * Auto-fills product/lot/expiry from the assembly note.
 * Calculates units-per-box from the CAJA item in note.items.
 * Generates QR on mount and sends TSPL labels via Bluetooth.
 * Calls onMarcadoChange so the wizard can save the box data on SIGUIENTE.
 */
const MarcadoCajasStep = ({ stepData, onMarcadoChange, allBatchNotes = [] }) => {
    const noteData = stepData;

    // ── Derive data from note ────────────────────────────────────────────────
    const product = noteData.product || {};
    const batchNumber = noteData.productionBatch?.batchNumber || noteData.noteNumber || '';

    // Units-per-box: use product's packSize/packPerBox, then fallback to CAJA item, then 1
    const cajaItem = (noteData.items || []).find(i =>
        i.component?.name?.toUpperCase().includes('CAJA')
    );
    const defaultUnitsPerBox = product.packSize
        || product.packPerBox
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
    const isEnsamble = noteData.processType?.code === 'ENSAMBLE';
    const totalTarros = (() => {
        if (isEnsamble && matchedTarget?.plannedUnits) return matchedTarget.plannedUnits;
        if (noteData.targetQuantity && (isWeightBased || noteData.targetQuantity < 50000)) return noteData.targetQuantity;
        if (matchedTarget?.plannedUnits) return matchedTarget.plannedUnits;
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

    // Expiry: use persisted expiresAt from batch, fallback to fabrication + 9 months
    const expiryDate = (() => {
        // Check batch-level expiresAt
        if (noteData.productionBatch?.expiresAt) {
            return new Date(noteData.productionBatch.expiresAt).toISOString().split('T')[0];
        }
        // Fallback: 9 months from fabrication (batch creation)
        const fabDate = noteData.productionBatch?.createdAt
            ? new Date(noteData.productionBatch.createdAt)
            : new Date();
        fabDate.setMonth(fabDate.getMonth() + 9);
        return fabDate.toISOString().split('T')[0];
    })();

    // ── Local state ──────────────────────────────────────────────────────────
    const [unitsPerBox, setUnitsPerBox] = useState(defaultUnitsPerBox);
    const [qrDataUrl, setQrDataUrl] = useState('');
    const [printed, setPrinted] = useState(false);
    const [printing, setPrinting] = useState(false);

    // Bluetooth state
    const [printerConnected, setPrinterConnected] = useState(printer.isConnected());
    const [printerName, setPrinterName] = useState(printer.getDeviceName() || '');

    const totalBoxes = unitsPerBox > 0 ? Math.ceil(totalTarros / unitsPerBox) : 0;

    // Listen for printer state changes
    useEffect(() => {
        const unsub = printer.onStateChange(({ connected, name }) => {
            setPrinterConnected(connected);
            if (name) setPrinterName(name);
        });
        // Try auto-reconnect on mount
        printer.tryAutoReconnect().then(r => {
            if (r) { setPrinterConnected(true); setPrinterName(r.name || ''); }
        });
        return unsub;
    }, []);

    // Notify wizard whenever boxes data changes
    useEffect(() => {
        onMarcadoChange?.({ unidadesPorCaja: unitsPerBox, totalCajas: totalBoxes });
    }, [unitsPerBox, totalBoxes, onMarcadoChange]);

    // ── QR generation (centralized via qrService) ────────────────────────────────────────
    const generateQR = useCallback(async () => {
        try {
            const { dataUrl } = await generateQrDataUrl(product.id, {
                lotNumber: batchNumber,
                quantity: unitsPerBox,
                expiresAt: expiryDate,
            });
            setQrDataUrl(dataUrl);
        } catch (e) {
            // Fallback to local generation if API fails
            console.warn('QR API fallback:', e);
            const { qrPayload } = buildQrPayloadLocal(product, batchNumber, unitsPerBox, expiryDate);
            try {
                const url = await QRCode.toDataURL(JSON.stringify(qrPayload), {
                    width: 400, margin: 2,
                    color: { dark: '#000000', light: '#FFFFFF' }
                });
                setQrDataUrl(url);
            } catch (e2) { console.error('QR fallback error:', e2); }
        }
    }, [product.id, product.sku, product.barcode, batchNumber, unitsPerBox, expiryDate]);

    useEffect(() => { generateQR(); }, [generateQR]);

    // ── Bluetooth connect ────────────────────────────────────────────────────
    const handleConnectPrinter = async () => {
        try {
            if (printerConnected) {
                const r = await printer.reconnect();
                if (r) { setPrinterConnected(true); setPrinterName(r.name || ''); }
            } else {
                const r = await printer.connect();
                if (r) { setPrinterConnected(true); setPrinterName(r.name || ''); }
            }
        } catch (err) {
            console.error('Printer connect error:', err);
        }
    };

    // ── Print via Bluetooth TSPL ─────────────────────────────────────────────
    const handlePrint = async () => {
        if (!printerConnected) return;

        const labelCount = totalBoxes > 0 ? totalBoxes : 1;
        const data = {
            productName: product.name || '',
            sku: product.sku || '',
            barcode: product.barcode || '',
            lotNumber: batchNumber,
            quantity: unitsPerBox,
            unit: isWeightBased ? 'gramo' : 'und',
            receivedAt: noteData.productionBatch?.createdAt || new Date().toISOString(),
            expiresAt: expiryDate ? new Date(expiryDate).toISOString() : null,
        };

        setPrinting(true);
        try {
            await printer.sendTSPL(buildLotLabel(data, labelCount));
            setPrinted(true);
        } catch (err) {
            console.error('Print error:', err);
            if (err.message?.includes('NetworkError') || err.message?.includes('disconnected') || err.message?.includes('GATT')) {
                setPrinterConnected(false);
            }
        } finally {
            setPrinting(false);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────
    const flavor = (product.name || '').replace(/LIQUIPOPS SABOR A?\s*/i, '').replace(/X\s*\d+/i, '').trim();
    const size = (product.name || '').match(/\d{3,4}\s*GR/i)?.[0] || '';
    const formattedExpiry = new Date(expiryDate).toLocaleDateString('es-CO');

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-8 pb-36 px-4">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold text-2xl shadow-md">
                    📦
                </div>
                <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                    ROTULADO DE CAJAS
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
                                <div className="text-xs text-amber-600 font-bold uppercase mb-1">Etiquetas</div>
                                <div className="text-2xl font-black text-amber-700">{totalBoxes}</div>
                                <div className="text-xs text-amber-400 mt-0.5">{unitsPerBox > 1 ? `${unitsPerBox} uds/caja` : 'por unidad'}</div>
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
                                <span className="text-slate-700">{formattedExpiry}</span>
                            </div>
                        </div>

                        {/* Bluetooth Printer Connection */}
                        <div className={`flex items-center gap-3 p-3 rounded-2xl border-2 ${printerConnected ? 'bg-emerald-50 border-emerald-300' : 'bg-slate-50 border-slate-200'}`}>
                            {printerConnected
                                ? <Bluetooth size={20} className="text-emerald-600" />
                                : <BluetoothOff size={20} className="text-slate-400" />
                            }
                            <div className="flex-1">
                                <div className={`text-sm font-bold ${printerConnected ? 'text-emerald-700' : 'text-slate-500'}`}>
                                    {printerConnected ? `🟢 ${printerName}` : 'Impresora no conectada'}
                                </div>
                            </div>
                            <button
                                onClick={handleConnectPrinter}
                                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${printerConnected
                                    ? 'bg-white border-2 border-emerald-400 text-emerald-600'
                                    : 'bg-indigo-500 text-white'}`}
                            >
                                {printerConnected ? 'Reconectar' : 'Conectar SAT AF330'}
                            </button>
                        </div>

                        {/* Print Button */}
                        <button
                            onClick={handlePrint}
                            disabled={!printerConnected || printing}
                            className={`w-full flex items-center justify-center gap-3 py-4 px-6 text-white font-black rounded-2xl shadow-lg transition-all text-lg
                                ${printerConnected ? 'bg-orange-500 hover:bg-orange-600' : 'bg-slate-300 cursor-not-allowed'}
                                ${printing ? 'opacity-50' : ''}`}
                        >
                            <Printer size={22} />
                            {printing ? 'Imprimiendo...'
                                : printed ? `✅ Reimprimir ${totalBoxes} Etiqueta${totalBoxes > 1 ? 's' : ''}`
                                : `🖨️ Imprimir ${totalBoxes} Etiqueta${totalBoxes > 1 ? 's' : ''} TSPL`}
                        </button>

                        {!printerConnected && (
                            <div className="text-center text-sm text-slate-400 font-medium">
                                ⬆ Conecte la impresora para imprimir
                            </div>
                        )}

                        {printed && (
                            <div className="text-center text-green-600 font-bold text-sm animate-pulse">
                                ✅ {totalBoxes} etiqueta{totalBoxes > 1 ? 's' : ''} enviada{totalBoxes > 1 ? 's' : ''} — presiona SIGUIENTE
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
                                        POPPING BOBA INT&apos;L
                                    </div>
                                    <div className="flex gap-2 flex-1">
                                        <img src={qrDataUrl} alt="QR" style={{ width: 100, height: 100 }}
                                            className="object-contain flex-shrink-0" />
                                        <div className="flex-1 flex flex-col text-xs">
                                            <div className="font-bold text-slate-800">{product.sku}</div>
                                            <div className="text-slate-600">Lote: <b>{batchNumber}</b></div>
                                            <div className="text-slate-500 text-xs">Vence: {formattedExpiry}</div>
                                            <div className="mt-2 border-2 border-black px-2 py-0.5 text-xs font-bold inline-block w-fit">
                                                CANT: {unitsPerBox}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="font-bold text-center text-xs mt-1 uppercase text-slate-700">
                                        {flavor} {size}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center w-64 h-52 rounded-2xl bg-slate-100">
                                <Package size={48} className="text-slate-300" />
                            </div>
                        )}
                        <p className="text-xs text-slate-400 text-center">
                            Vista previa 80mm × 50mm
                        </p>
                        <button
                            onClick={generateQR}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm text-slate-500 transition-all"
                        >
                            <RefreshCw size={16} /> Regenerar QR
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MarcadoCajasStep;
