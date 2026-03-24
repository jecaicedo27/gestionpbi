import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Scale, Package, Camera, CheckCircle, ChevronDown, Droplets, X, AlertTriangle } from 'lucide-react';

/**
 * InputStep — One material weighing step with:
 * - Multi-lot selection: pick multiple lots to cover the planned quantity
 * - AGUA: auto-generated lot (AAMMDD-HHMM, read-only)
 * - Photo evidence for all ingredients
 * - Blocks advancing until lot coverage >= planned qty
 */
const InputStep = ({
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
    const isWeight = ['kg', 'KG', 'gramo', 'gramos', 'g', 'G'].includes(item.unit);

    // Detect AGUA ingredient
    const materialName = (item.component?.name || '').toUpperCase();
    const isAgua = materialName.includes('AGUA');
    const componentId = item.componentId || item.component?.id;

    // Detect EMPAQUE process — auto-assign lots (operator doesn't select)
    const isAutoAssign = note?.processType?.code === 'EMPAQUE';

    // Detect COLOR EN POLVO ingredient for water dissolve feature
    const isColorPolvo = materialName.includes('COLOR') && materialName.includes('POLVO');
    const isConservantes = materialName.includes('CONSERVANTES') || materialName.includes('SORBATO') || materialName.includes('BENZOATO');

    // Auto-generate lot number for AGUA in AAMMDD-HHMM format
    useEffect(() => {
        if (isAgua && !lotNumbers[item.id]) {
            const now = new Date();
            const yy = String(now.getFullYear()).slice(-2);
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const mi = String(now.getMinutes()).padStart(2, '0');
            const autoLot = `${yy}${mm}${dd}-${hh}${mi}`;
            onLotNumberChange?.(item.id, autoLot);
        }
    }, [isAgua, item.id]);

    // Local state for photo preview
    const [photoPreview, setPhotoPreview] = useState(weighingPhotoUrl || '');

    // Water dissolve state (for COLOR EN POLVO)
    const [waterQty, setWaterQty] = useState(500);
    const [showWaterPanel, setShowWaterPanel] = useState(false);
    const [waterConfirmed, setWaterConfirmed] = useState(false);

    // Available lots from API
    const [availableLots, setAvailableLots] = useState([]);
    const [lotsLoading, setLotsLoading] = useState(false);
    const [useManualLot, setUseManualLot] = useState(false);

    // Multi-lot selections for this item
    const currentSelections = lotSelections[item.id] || [];
    const totalCovered = currentSelections.reduce((sum, s) => sum + (s.qty || 0), 0);
    const remaining = Math.max(0, planned - totalCovered);
    const isFullyCovered = totalCovered >= planned * 0.97 || isAgua || useManualLot || isAutoAssign;

    // IDs of lots already selected FOR THIS ITEM (to exclude from dropdown)
    const selectedLotIds = useMemo(() => new Set(currentSelections.map(s => s.lotId)), [currentSelections]);

    // Compute in-flight commitments: quantities committed by OTHER items in this note
    const committedByOthers = useMemo(() => {
        const committed = {}; // { lotId: totalQtyCommitted }
        Object.entries(lotSelections).forEach(([itemId, selections]) => {
            if (itemId === item.id) return; // skip current item
            (selections || []).forEach(sel => {
                committed[sel.lotId] = (committed[sel.lotId] || 0) + (sel.qty || 0);
            });
        });
        return committed;
    }, [lotSelections, item.id]);

    // Adjust available lots: subtract in-flight commitments, hide fully consumed
    const adjustedLots = useMemo(() => {
        return availableLots.map(lot => {
            const rawQty = lot.unit === 'kg' || lot.unit === 'KG'
                ? lot.currentQuantity * 1000
                : lot.currentQuantity;
            const alreadyCommitted = committedByOthers[lot.id] || 0;
            const effectiveQty = Math.max(0, rawQty - alreadyCommitted);
            return { ...lot, effectiveQty, rawQty };
        }).filter(lot => lot.effectiveQty > 0); // hide lots that are fully committed
    }, [availableLots, committedByOthers]);

    // Remaining available lots for dropdown (exclude already selected for this item)
    const unselectedLots = useMemo(() =>
        adjustedLots.filter(l => !selectedLotIds.has(l.id)),
        [adjustedLots, selectedLotIds]
    );

    // Reset lot state when ingredient changes
    useEffect(() => {
        setUseManualLot(false);
    }, [item.id]);

    // Sync photo preview from parent (restores on back-navigation)
    useEffect(() => {
        setPhotoPreview(weighingPhotoUrl || '');
    }, [item.id, weighingPhotoUrl]);

    // Fetch available lots for this ingredient (not AGUA)
    useEffect(() => {
        if (isAgua || !componentId) return;
        let cancelled = false;
        setLotsLoading(true);
        fetch(`/api/inventory/lots?productId=${componentId}&status=AVAILABLE,LOW_STOCK&zone=PRODUCTION`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        })
            .then(r => r.json())
            .then(data => {
                if (!cancelled && Array.isArray(data)) {
                    // Sort: soonest expiry first, nulls last
                    const sorted = data
                        .filter(l => l.currentQuantity > 0)
                        .sort((a, b) => {
                            if (!a.expiresAt && !b.expiresAt) return 0;
                            if (!a.expiresAt) return 1;
                            if (!b.expiresAt) return -1;
                            return new Date(a.expiresAt) - new Date(b.expiresAt);
                        });
                    setAvailableLots(sorted);

                    // Restore multi-lot selections when navigating back
                    // (selections are already in lotSelections state from parent)
                }
            })
            .catch(() => { })
            .finally(() => { if (!cancelled) setLotsLoading(false); });
        return () => { cancelled = true; };
    }, [componentId, isAgua]);

    // ═══ AUTO-ASSIGN LOTS FOR EMPAQUE ITEMS ═══
    // When lots finish loading for EMPAQUE items, auto-select FIFO to cover planned qty
    const autoAssignedRef = useRef(false);
    useEffect(() => {
        if (!isAutoAssign || availableLots.length === 0 || autoAssignedRef.current) return;
        if (currentSelections.length > 0) { autoAssignedRef.current = true; return; }
        
        autoAssignedRef.current = true;
        const newSelections = [];
        let remainingQty = planned;

        for (const lot of adjustedLots) {
            if (remainingQty <= 0) break;
            const qtyFromLot = Math.min(lot.effectiveQty, remainingQty);
            newSelections.push({
                lotId: lot.id,
                lotNumber: lot.lotNumber,
                qty: qtyFromLot,
                availableQty: lot.effectiveQty,
            });
            remainingQty -= qtyFromLot;
        }

        if (newSelections.length > 0) {
            updateSelections(newSelections);
            // Auto-fill actual qty = planned
            onActualQtyChange(item.id, String(planned));
        }
    }, [isAutoAssign, availableLots, adjustedLots, planned, item.id]);

    // Helper: update lot selections and sync lot number string
    const updateSelections = (newSelections) => {
        onLotSelectionsChange?.(item.id, newSelections);
        // Sync concatenated lot numbers to lotNumbers for backward compatibility
        const lotStr = newSelections.map(s => s.lotNumber).join(' + ');
        onLotNumberChange?.(item.id, lotStr);
        // Also pass first lot ID for backward compat
        const firstLotId = newSelections.length > 0 ? newSelections[0].lotId : null;
        onLotIdSelected?.(item.id, firstLotId);
    };

    const handleLotSelect = (e) => {
        const lotId = e.target.value;
        if (!lotId || lotId === '') return;
        if (lotId === '__manual__') {
            setUseManualLot(true);
            // Clear any existing selections
            updateSelections([]);
            onLotNumberChange?.(item.id, '');
            onLotIdSelected?.(item.id, null);
            return;
        }
        setUseManualLot(false);
        // Use adjustedLots which already has effectiveQty (with in-flight deductions)
        const lot = adjustedLots.find(l => l.id === lotId);
        if (!lot) return;

        // effectiveQty is already in grams and accounts for in-flight commitments
        const effectiveQty = lot.effectiveQty;

        // Use min(effectiveAvailable, remaining) as the quantity from this lot
        const qtyFromThisLot = Math.min(effectiveQty, remaining > 0 ? remaining : planned);

        const newSelection = {
            lotId: lot.id,
            lotNumber: lot.lotNumber,
            qty: qtyFromThisLot,
            availableQty: effectiveQty,
        };

        const newSelections = [...currentSelections, newSelection];
        updateSelections(newSelections);
    };

    const removeLotSelection = (lotId) => {
        const newSelections = currentSelections.filter(s => s.lotId !== lotId);
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
            const res = await fetch('/api/assembly-notes/upload-photo', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.url) {
                setPhotoPreview(data.url);
                onWeighingPhotoChange?.(item.id, data.url);
            }
        } catch (err) {
            console.warn('Upload failed, using local preview:', err);
            onWeighingPhotoChange?.(item.id, localUrl);
        }
    };

    const fmtQty = (q, unit) => {
        const weightUnits = ['g', 'gramo', 'gramos', 'kg'];
        if (unit && !weightUnits.includes(unit.toLowerCase())) {
            return `${q.toLocaleString()} ${unit}`;
        }
        return q >= 1000 ? `${(q / 1000).toFixed(1)} kg` : `${q.toLocaleString()} g`;
    };

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-2 pb-28 px-3">
            {/* Step counter badge */}
            <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-600 to-purple-500 text-white flex items-center justify-center font-black text-sm shadow-md">
                    {currentCount}
                </div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    INGREDIENTE {currentCount} DE {totalSteps}
                </div>
            </div>

            {/* Main card */}
            <div className="bg-white rounded-2xl shadow-lg border-2 border-violet-400 overflow-hidden flex-1 flex flex-col animate-in slide-in-from-right-8 duration-300">
                <div className="bg-gradient-to-r from-violet-600 to-purple-500 p-2.5 text-center">
                    <span className="text-white font-extrabold text-sm uppercase tracking-widest">
                        ⚖️ PESAR MATERIAL
                    </span>
                </div>

                <div className="flex-1 flex flex-col items-center justify-start p-4 gap-3">
                    {/* Process instruction banner */}
                    {note?.processParameters?.instruction && (
                        <div className="w-full max-w-lg bg-blue-50 border-2 border-blue-200 rounded-xl p-3 flex items-center gap-2">
                            <span className="text-lg">✅</span>
                            <div className="text-xs font-bold text-blue-700">
                                {note.processParameters.instruction}
                            </div>
                        </div>
                    )}
                    {/* Material name + icon */}
                    <div className="flex items-center gap-3 w-full max-w-lg">
                        <div className="h-10 w-10 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center flex-shrink-0">
                            {isWeight
                                ? <Scale size={22} className="text-violet-500" />
                                : <Package size={22} className="text-violet-500" />}
                        </div>
                        <div>
                            <div className="text-[10px] font-bold text-violet-400 uppercase">Material a pesar</div>
                            <div className="text-base font-black text-slate-800 leading-tight">
                                {item.component?.name || 'Material'}
                            </div>
                        </div>
                    </div>

                    {/* Planned qty chip */}
                    <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
                        <div className="bg-violet-50 rounded-xl p-3 text-center border border-violet-200">
                            <div className="text-[10px] font-bold text-violet-500 uppercase">Planificado</div>
                            <div className="text-2xl font-black text-violet-700">
                                {Number(planned).toLocaleString('es-CO', { maximumFractionDigits: 1 })}
                            </div>
                            <div className="text-xs text-violet-400">{item.unit}</div>
                            {batchMultiplier > 1 && (
                                <div className="mt-1.5 inline-block bg-amber-100 text-amber-700 border border-amber-300 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold">
                                    ×{batchMultiplier} baches
                                </div>
                            )}
                        </div>
                        <div className={`rounded-xl p-3 text-center border ${isOverOrUnder ? 'bg-amber-50 border-amber-300' : actual > 0 ? 'bg-green-50 border-green-300' : 'bg-slate-50 border-slate-200'}`}>
                            <div className={`text-[10px] font-bold uppercase ${isOverOrUnder ? 'text-amber-500' : actual > 0 ? 'text-green-500' : 'text-slate-400'}`}>
                                {deviation !== null ? (parseFloat(deviation) > 0 ? `+${deviation}%` : `${deviation}%`) : 'Pesado'}
                            </div>
                            <div className={`text-2xl font-black ${isOverOrUnder ? 'text-amber-700' : actual > 0 ? 'text-green-700' : 'text-slate-300'}`}>
                                {actual > 0 ? actual.toLocaleString('es-CO', { maximumFractionDigits: 1 }) : '—'}
                            </div>
                            <div className={`text-xs ${isOverOrUnder ? 'text-amber-400' : 'text-slate-400'}`}>{item.unit}</div>
                        </div>
                    </div>

                    {/* Actual quantity input */}
                    <div className="w-full max-w-lg">
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">
                            Cantidad Real Pesada
                        </label>
                        <input
                            type="number"
                            inputMode="decimal"
                            value={actualQty}
                            onChange={(e) => onActualQtyChange(item.id, e.target.value)}
                            placeholder={parseFloat(planned.toFixed(1)).toString()}
                            className={`w-full text-center text-2xl font-black py-3 px-4 rounded-xl border-2 
                                focus:outline-none focus:ring-2 transition-all
                                ${isOverOrUnder
                                    ? 'border-amber-400 bg-amber-50 focus:ring-amber-200 text-amber-700'
                                    : 'border-violet-300 bg-violet-50 focus:ring-violet-200 text-violet-700'
                                }`}
                        />
                        {deviation !== null && (
                            <div className={`mt-2 text-sm font-bold text-center ${isOverOrUnder ? 'text-amber-600' : 'text-green-600'}`}>
                                {parseFloat(deviation) > 0 ? `+${deviation}%` : `${deviation}%`} vs planificado
                                {isOverOrUnder && ' ⚠️ Fuera del rango (>5%)'}
                            </div>
                        )}
                    </div>

                    {/* Water dissolve section — fixed 700g for COLOR EN POLVO */}
                    {(isColorPolvo || isConservantes) && (
                        <div className="w-full max-w-lg">
                            {!waterConfirmed ? (
                                <button
                                    onClick={() => setWaterConfirmed(true)}
                                    className="w-full flex items-center justify-center gap-3 py-4 px-6 rounded-2xl
                                        bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-bold text-base
                                        shadow-lg hover:shadow-xl active:scale-95 transition-all"
                                >
                                    <Droplets size={24} />
                                    💧 DISOLVER EN {isConservantes ? '500' : '700'} ml DE AGUA
                                </button>
                            ) : (
                                <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-4 text-center">
                                    <div className="flex items-center justify-center gap-2 mb-1">
                                        <Droplets size={20} className="text-blue-500" />
                                        <span className="text-sm font-bold text-blue-600 uppercase">Agua para disolver</span>
                                    </div>
                                    <div className="text-3xl font-black text-blue-700">{isConservantes ? '500' : '700'} ml</div>
                                    <div className="text-xs text-blue-400 mt-1">✅ Cantidad fija registrada</div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Photo evidence — all ingredients */}
                    <div className="w-full max-w-lg">
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">
                            📷 Foto del Pesaje
                        </label>
                        {photoPreview && (
                            <img src={photoPreview} alt="Pesaje"
                                className="w-full max-h-32 object-cover rounded-xl border border-emerald-200 mb-2 shadow-sm" />
                        )}
                        <label className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed cursor-pointer transition-all active:scale-95
                            ${photoPreview
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                                : 'border-violet-300 bg-violet-50 text-violet-600 hover:bg-violet-100'}`}>
                            {photoPreview
                                ? <><CheckCircle size={18} /> <span className="font-bold text-xs">Foto tomada — Cambiar</span></>
                                : <><Camera size={18} /> <span className="font-bold text-xs">Tomar foto del pesaje</span></>
                            }
                            <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="sr-only"
                                onChange={handlePhotoCapture}
                            />
                        </label>
                    </div>

                    {/* Lot number — multi-lot or auto */}
                    <div className="w-full max-w-lg">
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">
                            Nº Lote del Insumo
                        </label>
                        {isAgua ? (
                            <div className="w-full text-center text-lg font-bold py-2 px-4 rounded-xl border-2
                                border-emerald-200 bg-emerald-50 text-emerald-700">
                                {lotNumbers[item.id] || '—'}
                                <div className="text-[10px] font-medium text-emerald-500 mt-0.5">Generado automáticamente</div>
                            </div>
                        ) : isAutoAssign ? (
                            <div className="space-y-2">
                                {currentSelections.length > 0 ? (
                                    <>
                                        {currentSelections.map((sel) => (
                                            <div key={sel.lotId} className="bg-emerald-50 border-2 border-emerald-200 rounded-xl px-4 py-3">
                                                <div className="font-bold text-emerald-800 text-sm">{sel.lotNumber}</div>
                                                <div className="text-xs text-emerald-600">
                                                    {sel.qty} {item.unit} asignadas
                                                </div>
                                            </div>
                                        ))}
                                        <div className="bg-emerald-50 border border-emerald-300 rounded-xl px-4 py-2 text-center">
                                            <span className="text-xs font-bold text-emerald-700">✅ Lotes asignados automáticamente (FIFO)</span>
                                        </div>
                                    </>
                                ) : lotsLoading ? (
                                    <div className="text-center py-3 text-slate-400 text-sm font-medium animate-pulse">
                                        ⏳ Cargando lotes disponibles...
                                    </div>
                                ) : (
                                    <div className="bg-amber-50 border-2 border-amber-200 rounded-xl px-4 py-3 text-center">
                                        <div className="text-xs font-bold text-amber-700">⚠️ No hay lotes disponibles en producción</div>
                                        <div className="text-sm font-black text-amber-800 mt-1">{item.component?.name || 'Material'}</div>
                                        <div className="text-xs text-amber-600 mt-0.5">Se necesitan: <span className="font-black">{fmtQty(planned, item.unit)}</span></div>
                                    </div>
                                )}
                            </div>
                        ) : availableLots.length > 0 && !useManualLot ? (
                            <div>
                                {/* Selected lots chips */}
                                {currentSelections.length > 0 && (
                                    <div className="space-y-2 mb-3">
                                        {currentSelections.map((sel) => (
                                            <div key={sel.lotId}
                                                className="flex items-center justify-between bg-emerald-50 border-2 border-emerald-200 rounded-xl px-4 py-3">
                                                <div className="flex-1">
                                                    <div className="font-bold text-emerald-800 text-sm">{sel.lotNumber}</div>
                                                    <div className="text-xs text-emerald-600">
                                                        Usando {fmtQty(sel.qty, item.unit)} de {fmtQty(sel.availableQty, item.unit)} disponibles
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => removeLotSelection(sel.lotId)}
                                                    className="p-1.5 rounded-full hover:bg-red-100 text-red-400 hover:text-red-600 transition-all"
                                                    title="Quitar lote"
                                                >
                                                    <X size={18} />
                                                </button>
                                            </div>
                                        ))}

                                        {/* Coverage summary */}
                                        <div className={`rounded-xl px-4 py-3 text-center border-2 ${isFullyCovered
                                            ? 'bg-green-50 border-green-300'
                                            : 'bg-amber-50 border-amber-300'
                                            }`}>
                                            {isFullyCovered ? (
                                                <div className="flex items-center justify-center gap-2">
                                                    <CheckCircle size={18} className="text-green-600" />
                                                    <span className="font-bold text-green-700 text-sm">
                                                        ✅ Cubierto: {fmtQty(totalCovered, item.unit)} / {fmtQty(planned, item.unit)}
                                                    </span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-center gap-2">
                                                    <AlertTriangle size={18} className="text-amber-600" />
                                                    <span className="font-bold text-amber-700 text-sm">
                                                        ⚠️ Faltan {fmtQty(remaining, item.unit)} — Seleccione otro lote
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Lot dropdown — keep showing if not fully covered or no selection yet */}
                                {(!isFullyCovered || currentSelections.length === 0) && unselectedLots.length > 0 && (
                                    <div className="relative">
                                        <select
                                            value=""
                                            onChange={handleLotSelect}
                                            className="w-full text-center text-base font-bold py-3 px-4 rounded-xl border-2 
                                                border-indigo-300 bg-indigo-50 focus:ring-2 focus:ring-indigo-200 focus:outline-none
                                                text-indigo-700 transition-all appearance-none cursor-pointer"
                                        >
                                            <option value="">
                                                {currentSelections.length === 0
                                                    ? '— Seleccionar Lote —'
                                                    : `— Agregar otro lote (faltan ${fmtQty(remaining, item.unit)}) —`}
                                            </option>
                                            {unselectedLots.map(lot => {
                                                const exp = lot.expiresAt ? new Date(lot.expiresAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
                                                return (
                                                    <option key={lot.id} value={lot.id}>
                                                        {lot.lotNumber} — {fmtQty(lot.effectiveQty, item.unit)} disp.{exp ? ` · Vence: ${exp}` : ''}
                                                    </option>
                                                );
                                            })}
                                            <option value="__manual__">✏️ Ingresar lote manual</option>
                                        </select>
                                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none" size={20} />
                                    </div>
                                )}

                                {/* No more lots available warning */}
                                {!isFullyCovered && unselectedLots.length === 0 && currentSelections.length > 0 && (
                                    <div className="mt-2 bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-2">
                                            <AlertTriangle size={18} className="text-red-600" />
                                            <span className="font-bold text-red-700 text-sm">
                                                No hay más lotes disponibles. Stock insuficiente. ({fmtQty(totalCovered, item.unit)} de {fmtQty(planned, item.unit)})
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => setUseManualLot(true)}
                                            className="mt-2 text-xs text-indigo-600 font-bold hover:underline"
                                        >
                                            ✏️ Ingresar lote manual
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div>
                                <input
                                    type="text"
                                    value={lotNumbers[item.id] || ''}
                                    onChange={(e) => onLotNumberChange?.(item.id, e.target.value)}
                                    placeholder="Ej: LOTE-2026-001"
                                    className="w-full text-center text-lg font-bold py-2 px-4 rounded-xl border-2 
                                        border-slate-200 bg-slate-50 focus:ring-2 focus:ring-slate-200 focus:outline-none
                                        text-slate-700 transition-all uppercase"
                                />
                                {availableLots.length > 0 && useManualLot && (
                                    <button onClick={() => setUseManualLot(false)}
                                        className="mt-2 text-xs text-indigo-500 font-bold hover:underline w-full text-center">
                                        ← Volver a seleccionar de lotes registrados
                                    </button>
                                )}
                                {!lotsLoading && availableLots.length === 0 && !isAgua && (
                                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center">
                                        <div className="text-xs text-amber-600 font-bold">⚠️ No hay lotes de <span className="font-black">{item.component?.name || 'este material'}</span></div>
                                        <div className="text-xs text-amber-500 mt-0.5">Se necesitan: <span className="font-black">{fmtQty(planned, item.unit)}</span></div>
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

export default InputStep;
