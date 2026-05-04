import React, { useState, useEffect, useCallback } from 'react';
import { Printer, Wifi, WifiOff, CheckCircle, RefreshCw, Package } from 'lucide-react';
import { buildLotLabelZPL, toInitials } from '../../../services/zplLabelBuilder';
import { useZebra } from '../../../context/ZebraContext';
import { useAuth } from '../../../context/AuthContext';
import api from '../../../services/api';

/**
 * PrintLotStep
 *
 * Simple step for printing a single Zebra label of an intermediate/premix lot.
 * Reads the lot produced by the previous Ensamble Siigo stage and offers a
 * single big "Imprimir" button. Blocks advance until label is printed.
 */
const PrintLotStep = ({ stepData, onPrintChange, allBatchNotes = [] }) => {
    const noteData = stepData;
    const product = noteData.product || {};
    const batchNumber = noteData.productionBatch?.batchNumber || '';

    const { zebraStatus, zebraIp, printZPL } = useZebra();
    const { user } = useAuth();
    const [printing, setPrinting] = useState(false);
    const [printed, setPrinted] = useState(!!noteData.processParameters?.lot_label_printed);
    const [printedAt, setPrintedAt] = useState(noteData.processParameters?.lot_label_printed_at || null);
    const [copies, setCopies] = useState(
        noteData.processParameters?.lot_label_copies
        || Math.max(1, Math.round(noteData.targetQuantity || noteData.actualQuantity || 1))
    );
    const [error, setError] = useState(null);

    // Try to find the lot produced by a previous Ensamble Siigo of the same product
    const [lotInfo, setLotInfo] = useState(null);
    // Group info: count of active batches with same flavor (sibling batches in the same programming session)
    const [groupInfo, setGroupInfo] = useState({ index: 1, total: 1 });

    useEffect(() => {
        const ensamble = allBatchNotes.find(n =>
            ['ENSAMBLE', 'G_ENSAMBLE'].includes(n.processType?.code) &&
            n.status === 'COMPLETED' &&
            n.productId === product.id
        );
        if (ensamble?.actualQuantity) {
            setLotInfo({
                quantity: ensamble.actualQuantity,
                unit: ensamble.unit || product.unit || 'unidad',
                completedAt: ensamble.completedAt,
            });
        } else {
            const plannedQty = noteData.items?.reduce((sum, i) => sum + (i.plannedQuantity || 0), 0)
                || noteData.targetQuantity
                || 1;
            setLotInfo({
                quantity: plannedQty,
                unit: product.unit || 'unidad',
                completedAt: new Date().toISOString(),
            });
        }
    }, [allBatchNotes, product.id, noteData]);

    // Compute group info — sibling batches with same productId + active status
    useEffect(() => {
        const fetchGroup = async () => {
            try {
                if (!product.id || !noteData.productionBatch?.id) return;
                const res = await api.get(`/production-batches?productId=${product.id}&active=true`);
                const all = res.data || [];
                // Same flavor (or same product) — created within ±24h of this batch
                const thisCreatedAt = new Date(noteData.productionBatch.createdAt || Date.now()).getTime();
                const WINDOW_MS = 24 * 60 * 60 * 1000;
                const siblings = all
                    .filter(b => Math.abs(new Date(b.createdAt).getTime() - thisCreatedAt) < WINDOW_MS)
                    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                const total = siblings.length || 1;
                const index = siblings.findIndex(b => b.id === noteData.productionBatch.id) + 1 || 1;
                setGroupInfo({ index, total });
            } catch (e) {
                console.warn('Could not fetch group info:', e.message);
            }
        };
        fetchGroup();
    }, [product.id, noteData.productionBatch?.id, noteData.productionBatch?.createdAt]);

    useEffect(() => {
        onPrintChange?.({ printed, copies });
    }, [printed, copies, onPrintChange]);

    const handlePrint = async () => {
        if (zebraStatus !== 'connected') {
            setError('Zebra no conectada');
            return;
        }
        setPrinting(true);
        setError(null);
        try {
            const baseData = {
                productName: product.name || '',
                sku: product.sku || '',
                barcode: product.barcode || '',
                lotNumber: batchNumber,
                quantity: lotInfo?.quantity || 1,
                unit: lotInfo?.unit || product.unit || 'unidad',
                receivedAt: noteData.productionBatch?.createdAt || new Date().toISOString(),
                expiresAt: null,
                boxNumber: groupInfo.index,
                totalBoxes: groupInfo.total,
                printedBy: toInitials(user?.name),
            };
            const zpl = buildLotLabelZPL(baseData, copies);
            const result = await printZPL(zpl);
            if (!result.ok) throw new Error(result.error || 'Error Zebra');

            const now = new Date().toISOString();
            setPrinted(true);
            setPrintedAt(now);

            // Persist to BD
            await api.patch(`/assembly-notes/${noteData.id}`, {
                processParameters: {
                    ...noteData.processParameters,
                    lot_label_printed: true,
                    lot_label_printed_at: now,
                    lot_label_copies: copies,
                }
            });

            // Mark MaterialLot as printed (look up by lot summary)
            try {
                const summary = await api.get(`/finished-lots/lot-summary/${encodeURIComponent(batchNumber)}`);
                const matchingLot = (summary.data?.materialLots || []).find(l => l.productId === product.id);
                if (matchingLot?.id) {
                    await api.post('/finished-lots/mark-printed', {
                        lotId: matchingLot.id,
                        type: 'material',
                    });
                }
            } catch (e) {
                console.warn('Could not mark lot as printed:', e.message);
            }
        } catch (err) {
            setError(err.message || 'Error al imprimir');
            console.error('Print error:', err);
        } finally {
            setPrinting(false);
        }
    };

    const isReady = zebraStatus === 'connected';

    return (
        <div className="max-w-2xl mx-auto p-4 space-y-4">
            <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-5 border-2 border-indigo-200">
                <div className="flex items-center gap-3 mb-3">
                    <div className="text-3xl">🖨️</div>
                    <div>
                        <div className="text-lg font-bold text-indigo-900">Impresión Etiqueta del Lote</div>
                        <div className="text-xs text-indigo-700">Imprime la etiqueta Zebra del lote producido</div>
                    </div>
                </div>

                {/* Lot info card */}
                <div className="bg-white rounded-xl p-4 border border-indigo-100 mb-4">
                    <div className="flex items-center gap-2 mb-3">
                        <Package className="w-4 h-4 text-indigo-600" />
                        <span className="text-sm font-bold text-gray-700">Datos del lote</span>
                    </div>
                    <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between">
                            <span className="text-gray-500">Producto:</span>
                            <span className="font-bold text-gray-800 text-right">{product.name}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">SKU:</span>
                            <span className="font-mono text-xs text-gray-700">{product.sku}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Lote:</span>
                            <span className="font-mono text-xs font-bold text-indigo-700">{batchNumber}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">Cantidad:</span>
                            <span className="font-bold text-gray-800">
                                {lotInfo ? `${lotInfo.quantity.toLocaleString('es-CO')} ${lotInfo.unit}` : '...'}
                            </span>
                        </div>
                        {groupInfo.total > 1 && (
                            <div className="flex justify-between border-t border-indigo-100 pt-1.5 mt-1.5">
                                <span className="text-gray-500">Lote del grupo:</span>
                                <span className="font-bold text-indigo-700 text-base">
                                    {groupInfo.index} de {groupInfo.total}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Copies selector */}
                <div className="flex items-center gap-3 mb-4">
                    <span className="text-xs font-bold text-gray-600 uppercase">Copias:</span>
                    <button
                        onClick={() => setCopies(c => Math.max(1, c - 1))}
                        className="w-9 h-9 rounded-lg border-2 border-gray-300 bg-white text-gray-700 font-bold text-lg flex items-center justify-center hover:bg-gray-50"
                        disabled={printing}
                    >−</button>
                    <input
                        type="number"
                        min="1"
                        max="10"
                        value={copies}
                        onChange={e => setCopies(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                        className="w-16 text-center text-lg font-bold border-2 border-gray-200 rounded-lg py-1.5 focus:border-indigo-400 outline-none"
                        disabled={printing}
                    />
                    <button
                        onClick={() => setCopies(c => Math.min(10, c + 1))}
                        className="w-9 h-9 rounded-lg border-2 border-gray-300 bg-white text-gray-700 font-bold text-lg flex items-center justify-center hover:bg-gray-50"
                        disabled={printing}
                    >+</button>
                </div>

                {/* Zebra status */}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-3 text-sm ${
                    isReady ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border border-amber-200 text-amber-800'
                }`}>
                    {isReady ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                    <span className="font-semibold">
                        {isReady ? `Zebra conectada (${zebraIp || 'red'})` :
                         zebraStatus === 'unreachable' ? 'Zebra no alcanzable — verifica que esté encendida' :
                         'Verificando Zebra...'}
                    </span>
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg mb-3 text-sm">
                        ⚠️ {error}
                    </div>
                )}

                {/* Print button */}
                <button
                    onClick={handlePrint}
                    disabled={!isReady || printing}
                    className={`w-full flex items-center justify-center gap-2 py-4 rounded-xl text-white font-bold text-lg transition-all ${
                        !isReady || printing
                            ? 'bg-gray-400 cursor-not-allowed'
                            : printed
                                ? 'bg-emerald-600 hover:bg-emerald-700'
                                : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                >
                    {printing ? (
                        <><RefreshCw className="w-5 h-5 animate-spin" /> Imprimiendo...</>
                    ) : printed ? (
                        <><CheckCircle className="w-5 h-5" /> Reimprimir Etiqueta ({copies})</>
                    ) : (
                        <><Printer className="w-5 h-5" /> Imprimir Etiqueta ({copies})</>
                    )}
                </button>

                {printed && printedAt && (
                    <div className="mt-3 text-center text-sm text-emerald-700 font-semibold">
                        ✓ Etiqueta impresa el {new Date(printedAt).toLocaleString('es-CO')}
                    </div>
                )}

                {!printed && (
                    <div className="mt-3 text-center text-xs text-gray-500">
                        Debes imprimir la etiqueta antes de continuar
                    </div>
                )}
            </div>
        </div>
    );
};

export default PrintLotStep;
