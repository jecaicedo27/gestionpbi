import React, { useState } from 'react';
import { Scale, Package, Camera, CheckCircle, ChevronDown, X, AlertTriangle } from 'lucide-react';
import api from '../../../services/api';

/**
 * GInputStep — Paso de Pesaje para Geniality (Siropes)
 * Versión limpia sin lógica hardcodeada de Liquipops (sin AGUA auto, sin COLOR EN POLVO).
 * El operador selecciona lotes disponibles del inventario y registra la cantidad real pesada.
 */
const GInputStep = ({
    stepData,
    currentCount,
    totalSteps,
    actualQuantities = {},
    onActualQtyChange,
    lotNumbers = {},
    onLotNumberChange,
    onWeighingPhotoChange,
    weighingPhotoUrl,
    onLotIdSelected,
    lotSelections = {},
    onLotSelectionsChange,
    batchMultiplier = 1,
    note,
}) => {
    const item = stepData;
    const actualQty = actualQuantities[item.id] ?? '';
    const planned = item.plannedQuantity || 0;
    const actual = parseFloat(actualQty) || 0;
    const deviation = planned > 0 && actual > 0 ? (((actual - planned) / planned) * 100).toFixed(1) : null;
    const isOverOrUnder = deviation !== null ? (Math.abs(parseFloat(deviation)) > 5) : false;
    const componentId = item.componentId || item.component?.id;

    const [photoPreview, setPhotoPreview] = useState(weighingPhotoUrl || '');
    const [availableLots, setAvailableLots] = useState([]);
    const [lotsLoading, setLotsLoading] = useState(false);
    const [useManualLot, setUseManualLot] = useState(false);
    const [lotRefetchKey, setLotRefetchKey] = useState(0);

    const currentSelections = lotSelections[item.id] || [];
    const totalCovered = currentSelections.reduce((sum, s) => sum + (s.qty || 0), 0);
    const remaining = Math.max(0, planned - totalCovered);
    const isFullyCovered = totalCovered >= planned * 0.97 || useManualLot;

    React.useEffect(() => {
        if (!componentId) return;
        let cancelled = false;
        setLotsLoading(true);
        api.get(`/inventory/lots?productId=${componentId}&status=AVAILABLE,LOW_STOCK&zone=PRODUCTION`)
            .then(res => res.data)
            .then(data => {
                if (!cancelled && Array.isArray(data)) {
                    const sorted = data
                        .filter(l => l.currentQuantity > 0)
                        .sort((a, b) => {
                            if (!a.expiresAt && !b.expiresAt) return 0;
                            if (!a.expiresAt) return 1;
                            if (!b.expiresAt) return -1;
                            return new Date(a.expiresAt) - new Date(b.expiresAt);
                        });
                    setAvailableLots(sorted);
                }
            })
            .catch(() => { })
            .finally(() => { if (!cancelled) setLotsLoading(false); });
        return () => { cancelled = true; };
    }, [componentId, lotRefetchKey]);

    const fmtQty = (q, unit) => {
        const weightUnits = ['g', 'gramo', 'gramos', 'kg'];
        if (unit && !weightUnits.includes(unit.toLowerCase())) return `${q.toLocaleString()} ${unit}`;
        return q >= 1000 ? `${(q / 1000).toFixed(2)} kg` : `${q.toLocaleString()} g`;
    };

    const selectedLotIds = new Set(currentSelections.map(s => s.lotId));
    const unselectedLots = availableLots.filter(l => !selectedLotIds.has(l.id));

    const updateSelections = (newSelections) => {
        onLotSelectionsChange?.(item.id, newSelections);
        const lotStr = newSelections.map(s => s.lotNumber).join(' + ');
        onLotNumberChange?.(item.id, lotStr);
        const firstLotId = newSelections.length > 0 ? newSelections[0].lotId : null;
        onLotIdSelected?.(item.id, firstLotId);
    };

    const handleLotSelect = (e) => {
        const lotId = e.target.value;
        if (!lotId || lotId === '') return;
        if (lotId === '__manual__') { setUseManualLot(true); updateSelections([]); return; }
        setUseManualLot(false);
        const lot = availableLots.find(l => l.id === lotId);
        if (!lot) return;
        const rawQty = lot.unit === 'kg' || lot.unit === 'KG' ? lot.currentQuantity * 1000 : lot.currentQuantity;
        const qtyFromLot = Math.min(rawQty, remaining > 0 ? remaining : planned);
        const newSelections = [...currentSelections, { lotId: lot.id, lotNumber: lot.lotNumber, qty: qtyFromLot, availableQty: rawQty }];
        updateSelections(newSelections);
    };

    const handlePhotoCapture = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const localUrl = URL.createObjectURL(file);
        setPhotoPreview(localUrl);
        try {
            const fd = new FormData();
            fd.append('photo', file);
            fd.append('noteId', item.assemblyNoteId || '');
            fd.append('context', `pesaje_${item.component?.name || item.id}`);
            const res = await api.post('/assembly-notes/upload-photo', fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            const data = res.data;
            if (data.url) { setPhotoPreview(data.url); onWeighingPhotoChange?.(item.id, data.url); }
        } catch {
            onWeighingPhotoChange?.(item.id, localUrl);
        }
    };

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-2 pb-28 px-3">
            <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-emerald-600 to-teal-500 text-white flex items-center justify-center font-black text-sm shadow-md">
                    {currentCount}
                </div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    INGREDIENTE {currentCount} DE {totalSteps}
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border-2 border-emerald-400 overflow-hidden flex-1 flex flex-col">
                <div className="bg-gradient-to-r from-emerald-600 to-teal-500 p-2.5 text-center">
                    <span className="text-white font-extrabold text-sm uppercase tracking-widest">⚖️ PESAR INGREDIENTE</span>
                </div>

                <div className="flex-1 flex flex-col items-center justify-start p-4 gap-3">
                    {note?.processParameters?.instruction && (
                        <div className="w-full max-w-lg bg-blue-50 border-2 border-blue-200 rounded-xl p-3">
                            <div className="text-xs font-bold text-blue-700">{note.processParameters.instruction}</div>
                        </div>
                    )}

                    <div className="flex items-center gap-3 w-full max-w-lg">
                        <div className="h-10 w-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center flex-shrink-0">
                            <Scale size={22} className="text-emerald-500" />
                        </div>
                        <div>
                            <div className="text-[10px] font-bold text-emerald-400 uppercase">Ingrediente a pesar</div>
                            <div className="text-base font-black text-slate-800 leading-tight">{item.component?.name || 'Material'}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
                        <div className="bg-emerald-50 rounded-xl p-3 text-center border border-emerald-200">
                            <div className="text-[10px] font-bold text-emerald-500 uppercase">Planificado</div>
                            <div className="text-2xl font-black text-emerald-700">{Number(planned).toLocaleString('es-CO', { maximumFractionDigits: 1 })}</div>
                            <div className="text-xs text-emerald-400">{item.unit}</div>
                            {batchMultiplier > 1 && (
                                <div className="mt-1 inline-block bg-amber-100 text-amber-700 border border-amber-300 rounded-full px-2 py-0.5 text-[11px] font-extrabold">
                                    ×{batchMultiplier} baches
                                </div>
                            )}
                        </div>
                        <div className={`rounded-xl p-3 text-center border ${isOverOrUnder ? 'bg-amber-50 border-amber-300' : actual > 0 ? 'bg-green-50 border-green-300' : 'bg-slate-50 border-slate-200'}`}>
                            <div className={`text-[10px] font-bold uppercase ${isOverOrUnder ? 'text-amber-500' : actual > 0 ? 'text-green-500' : 'text-slate-400'}`}>
                                {deviation !== null ? (parseFloat(deviation) > 0 ? `+${deviation}%` : `${deviation}%`) : 'Real'}
                            </div>
                            <div className={`text-2xl font-black ${isOverOrUnder ? 'text-amber-700' : actual > 0 ? 'text-green-700' : 'text-slate-300'}`}>
                                {actual > 0 ? actual.toLocaleString('es-CO', { maximumFractionDigits: 1 }) : '—'}
                            </div>
                            <div className={`text-xs ${isOverOrUnder ? 'text-amber-400' : 'text-slate-400'}`}>{item.unit}</div>
                        </div>
                    </div>

                    {/* Cantidad real */}
                    <div className="w-full max-w-lg">
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">Cantidad Real Pesada</label>
                        <input
                            type="number" inputMode="decimal" value={actualQty}
                            onChange={(e) => onActualQtyChange(item.id, e.target.value)}
                            placeholder={parseFloat(planned.toFixed(1)).toString()}
                            className={`w-full text-center text-2xl font-black py-3 px-4 rounded-xl border-2 
                                focus:outline-none focus:ring-2 transition-all
                                ${isOverOrUnder ? 'border-amber-400 bg-amber-50 focus:ring-amber-200 text-amber-700' : 'border-emerald-300 bg-emerald-50 focus:ring-emerald-200 text-emerald-700'}`}
                        />
                        {deviation !== null && (
                            <div className={`mt-2 text-sm font-bold text-center ${isOverOrUnder ? 'text-amber-600' : 'text-green-600'}`}>
                                {parseFloat(deviation) > 0 ? `+${deviation}%` : `${deviation}%`} vs planificado
                                {isOverOrUnder && ' ⚠️ Fuera del rango (>5%)'}
                            </div>
                        )}
                    </div>

                    {/* Foto — OBLIGATORIO */}
                    <div className="w-full max-w-lg">
                        <label className={`text-xs font-bold uppercase mb-1.5 flex items-center gap-1.5 ${photoPreview ? 'text-emerald-600' : 'text-red-500'}`}>
                            📷 Foto del Pesaje
                            {!photoPreview && <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-black animate-pulse">OBLIGATORIO</span>}
                            {photoPreview && <span className="text-emerald-500 text-[9px]">✅</span>}
                        </label>
                        {photoPreview && <img src={photoPreview} alt="Pesaje" className="w-full max-h-32 object-cover rounded-xl border-2 border-emerald-300 mb-2 shadow-sm" />}
                        <label className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed cursor-pointer transition-all active:scale-95 ${photoPreview ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100 animate-pulse'}`}>
                            {photoPreview ? <><CheckCircle size={18} /> <span className="font-bold text-xs">Foto tomada — Cambiar</span></> : <><Camera size={18} /> <span className="font-bold text-xs">⚠️ TOMAR FOTO DEL PESAJE</span></>}
                            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handlePhotoCapture} />
                        </label>
                    </div>

                    {/* Selección de Lote */}
                    <div className="w-full max-w-lg">
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-bold text-slate-500 uppercase">Nº Lote del Insumo</label>
                            <button
                                onClick={() => setLotRefetchKey(k => k + 1)}
                                disabled={lotsLoading}
                                className="flex items-center gap-1 text-[10px] font-bold text-teal-500 hover:text-teal-700 disabled:opacity-40 transition-all"
                            >
                                {lotsLoading ? '⏳' : '🔄'} Recargar lotes
                            </button>
                        </div>
                        {currentSelections.length > 0 && (
                            <div className="space-y-2 mb-3">
                                {currentSelections.map(sel => (
                                    <div key={sel.lotId} className="flex items-center justify-between bg-emerald-50 border-2 border-emerald-200 rounded-xl px-4 py-3">
                                        <div>
                                            <div className="font-bold text-emerald-800 text-sm">{sel.lotNumber}</div>
                                            <div className="text-xs text-emerald-600">Usando {fmtQty(sel.qty, item.unit)}</div>
                                        </div>
                                        <button onClick={() => updateSelections(currentSelections.filter(s => s.lotId !== sel.lotId))}
                                            className="p-1.5 rounded-full hover:bg-red-100 text-red-400 hover:text-red-600 transition-all">
                                            <X size={16} />
                                        </button>
                                    </div>
                                ))}
                                <div className={`rounded-xl px-4 py-2 text-center border-2 ${isFullyCovered ? 'bg-green-50 border-green-300' : 'bg-amber-50 border-amber-300'}`}>
                                    {isFullyCovered
                                        ? <span className="font-bold text-green-700 text-sm">✅ Cubierto: {fmtQty(totalCovered, item.unit)}</span>
                                        : <span className="font-bold text-amber-700 text-sm">⚠️ Faltan {fmtQty(remaining, item.unit)}</span>}
                                </div>
                            </div>
                        )}

                        {!isFullyCovered && !useManualLot && unselectedLots.length > 0 && (
                            <div className="relative">
                                <select value="" onChange={handleLotSelect}
                                    className="w-full text-center text-base font-bold py-3 px-4 rounded-xl border-2 border-teal-300 bg-teal-50 focus:ring-2 focus:ring-teal-200 focus:outline-none text-teal-700 appearance-none cursor-pointer">
                                    <option value="">{currentSelections.length === 0 ? '— Seleccionar Lote —' : `— Agregar lote (faltan ${fmtQty(remaining, item.unit)}) —`}</option>
                                    {unselectedLots.map(lot => {
                                        const rawQty = lot.unit === 'kg' || lot.unit === 'KG' ? lot.currentQuantity * 1000 : lot.currentQuantity;
                                        const exp = lot.expiresAt ? new Date(lot.expiresAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '';
                                        return <option key={lot.id} value={lot.id}>{lot.lotNumber} — {fmtQty(rawQty, item.unit)} disp.{exp ? ` · Vence: ${exp}` : ''}</option>;
                                    })}
                                    <option value="__manual__">✏️ Ingresar lote manual</option>
                                </select>
                                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-teal-400 pointer-events-none" size={18} />
                            </div>
                        )}

                        {lotsLoading && !useManualLot && currentSelections.length === 0 && (
                            <div className="text-center py-3 text-slate-400 text-sm animate-pulse">⏳ Cargando lotes...</div>
                        )}

                        {(useManualLot || (!lotsLoading && availableLots.length === 0 && !isFullyCovered)) && (
                            <div>
                                <input type="text" value={lotNumbers[item.id] || ''}
                                    onChange={(e) => onLotNumberChange?.(item.id, e.target.value)}
                                    placeholder="Ej: G-2026-001"
                                    className="w-full text-center text-lg font-bold py-2 px-4 rounded-xl border-2 border-slate-200 bg-slate-50 focus:ring-2 focus:ring-slate-200 focus:outline-none text-slate-700 uppercase" />
                                {availableLots.length > 0 && (
                                    <button onClick={() => setUseManualLot(false)} className="mt-2 text-xs text-teal-500 font-bold hover:underline w-full text-center">
                                        ← Volver a seleccionar de lotes registrados
                                    </button>
                                )}
                                {!lotsLoading && availableLots.length === 0 && (
                                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center">
                                        <div className="text-xs text-amber-600 font-bold">⚠️ Sin lotes en zona de producción para <span className="font-black">{item.component?.name}</span></div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GInputStep;
