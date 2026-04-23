import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Droplets, Camera, CheckCircle, ChevronDown, X, Play } from 'lucide-react';

const getIngredientOrder = (name) => {
    const upper = (name || '').toUpperCase();
    if (upper.includes('AGUA')) return { order: 1, label: 'AGUA', color: 'blue' };
    if (upper.includes('ACIDO') || upper.includes('ÁCIDO')) return { order: 2, label: 'ÁCIDO CÍTRICO', color: 'orange' };
    if (upper.includes('GLUCOSA')) return { order: 4, label: 'GLUCOSA', color: 'purple' };
    if (upper.includes('FRUCTOSA')) return { order: 4, label: 'FRUCTOSA', color: 'purple' };
    if (upper.includes('AZUCAR') || upper.includes('AZÚCAR')) return { order: 3, label: 'AZÚCAR', color: 'amber' };
    return { order: 99, label: name, color: 'slate' };
};

const fmtQty = (q, unit) => {
    const weightUnits = ['g', 'gramo', 'gramos', 'kg'];
    if (unit && !weightUnits.includes((unit || '').toLowerCase())) return `${q.toLocaleString()} ${unit}`;
    return q >= 1000 ? `${(q / 1000).toFixed(1)} kg` : `${q.toLocaleString()} g`;
};

const PesajeBatchStep = ({
    stepData: items,
    note,
    actualQuantities = {},
    onActualQtyChange,
    lotNumbers = {},
    onLotNumberChange,
    onWeighingPhotoChange,
    weighingPhotos = {},
    onLotIdSelected,
    lotSelections = {},
    onLotSelectionsChange,
}) => {
    const sortedItems = useMemo(() =>
        [...items].sort((a, b) => getIngredientOrder(a.component?.name).order - getIngredientOrder(b.component?.name).order),
    [items]);

    const aguaItem = useMemo(() => sortedItems.find(i => (i.component?.name || '').toUpperCase().includes('AGUA')), [sortedItems]);
    const otherItems = useMemo(() => sortedItems.filter(i => !(i.component?.name || '').toUpperCase().includes('AGUA')), [sortedItems]);

    const [itemPhotos, setItemPhotos] = useState({});
    const [availableLotsMap, setAvailableLotsMap] = useState({});
    const [useManualLotMap, setUseManualLotMap] = useState({});

    // Water filling state
    const [waterStartedAt, setWaterStartedAt] = useState(() => {
        const saved = note?.processParameters?.water_started_at;
        return saved ? new Date(saved) : null;
    });
    const [waterElapsed, setWaterElapsed] = useState('');
    const waterTimerRef = useRef(null);

    useEffect(() => {
        if (!waterStartedAt) return;
        const tick = () => {
            const diff = Math.floor((Date.now() - waterStartedAt.getTime()) / 1000);
            const mins = Math.floor(diff / 60);
            const secs = diff % 60;
            setWaterElapsed(`${mins}:${String(secs).padStart(2, '0')}`);
        };
        tick();
        waterTimerRef.current = setInterval(tick, 1000);
        return () => clearInterval(waterTimerRef.current);
    }, [waterStartedAt]);

    const handleStartWater = async () => {
        const now = new Date();
        setWaterStartedAt(now);
        try {
            await fetch(`/api/assembly-notes/${note?.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify({ processParameters: { ...note?.processParameters, water_started_at: now.toISOString() } })
            });
        } catch (e) {}
    };

    // Auto-generate lot for AGUA
    useEffect(() => {
        if (aguaItem && !lotNumbers[aguaItem.id]) {
            const now = new Date();
            const yy = String(now.getFullYear()).slice(-2);
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const mi = String(now.getMinutes()).padStart(2, '0');
            onLotNumberChange?.(aguaItem.id, `${yy}${mm}${dd}-${hh}${mi}`);
        }
    }, []);

    // Fetch lots for non-AGUA items
    useEffect(() => {
        otherItems.forEach(item => {
            const componentId = item.componentId || item.component?.id;
            if (!componentId) return;
            fetch(`/api/inventory/lots?productId=${componentId}&status=AVAILABLE,LOW_STOCK&zone=PRODUCTION`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            })
                .then(r => r.json())
                .then(data => {
                    if (Array.isArray(data)) {
                        const sorted = data.filter(l => l.currentQuantity > 0).sort((a, b) => {
                            if (!a.expiresAt && !b.expiresAt) return 0;
                            if (!a.expiresAt) return 1;
                            if (!b.expiresAt) return -1;
                            return new Date(a.expiresAt) - new Date(b.expiresAt);
                        });
                        setAvailableLotsMap(prev => ({ ...prev, [item.id]: sorted }));
                    }
                })
                .catch(() => {});
        });
    }, []);

    // Restore photos
    useEffect(() => {
        const saved = note?.processParameters?.weighing_photos || {};
        const restored = {};
        Object.entries(saved).forEach(([id, url]) => { if (url) restored[id] = url; });
        if (Object.keys(restored).length > 0) setItemPhotos(restored);
    }, [note?.id]);

    const isItemComplete = useCallback((item) => {
        const isAgua = (item.component?.name || '').toUpperCase().includes('AGUA');
        const hasQty = actualQuantities[item.id] !== undefined && actualQuantities[item.id] !== '';
        const hasLot = !!lotNumbers[item.id]?.trim();
        const hasPhoto = !!(itemPhotos[item.id] || weighingPhotos[item.id] || note?.processParameters?.weighing_photos?.[item.id]);
        return isAgua ? hasQty && hasLot : hasQty && hasLot && hasPhoto;
    }, [actualQuantities, lotNumbers, itemPhotos, weighingPhotos, note]);

    const handlePhotoCapture = async (item, e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const localUrl = URL.createObjectURL(file);
        setItemPhotos(prev => ({ ...prev, [item.id]: localUrl }));
        try {
            const fd = new FormData();
            fd.append('photo', file);
            fd.append('noteId', note?.id || '');
            fd.append('context', `pesaje_${item.component?.name || item.id}`);
            const res = await fetch('/api/assembly-notes/upload-photo', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.url) {
                setItemPhotos(prev => ({ ...prev, [item.id]: data.url }));
                onWeighingPhotoChange?.(item.id, data.url);
            }
        } catch (err) {
            onWeighingPhotoChange?.(item.id, localUrl);
        }
    };

    const handleLotSelect = (item, lotId) => {
        if (!lotId || lotId === '__manual__') {
            setUseManualLotMap(prev => ({ ...prev, [item.id]: true }));
            onLotNumberChange?.(item.id, '');
            return;
        }
        setUseManualLotMap(prev => ({ ...prev, [item.id]: false }));
        const lots = availableLotsMap[item.id] || [];
        const lot = lots.find(l => l.id === lotId);
        if (!lot) return;
        const effectiveQty = lot.unit === 'kg' || lot.unit === 'KG' ? lot.currentQuantity * 1000 : lot.currentQuantity;
        const planned = item.plannedQuantity || 0;
        const currentSel = lotSelections[item.id] || [];
        const totalCovered = currentSel.reduce((s, sel) => s + (sel.qty || 0), 0);
        const remaining = Math.max(0, planned - totalCovered);
        const newSelections = [...currentSel, { lotId: lot.id, lotNumber: lot.lotNumber, qty: Math.min(effectiveQty, remaining > 0 ? remaining : planned), availableQty: effectiveQty }];
        onLotSelectionsChange?.(item.id, newSelections);
        onLotNumberChange?.(item.id, newSelections.map(s => s.lotNumber).join(' + '));
        onLotIdSelected?.(item.id, newSelections[0]?.lotId || null);
    };

    const removeLotSelection = (item, lotId) => {
        const newSelections = (lotSelections[item.id] || []).filter(s => s.lotId !== lotId);
        onLotSelectionsChange?.(item.id, newSelections);
        onLotNumberChange?.(item.id, newSelections.map(s => s.lotNumber).join(' + '));
        onLotIdSelected?.(item.id, newSelections[0]?.lotId || null);
    };

    const aguaActual = aguaItem ? (parseFloat(actualQuantities[aguaItem.id]) || 0) : 0;
    const aguaComplete = aguaItem ? isItemComplete(aguaItem) : true;
    const completedCount = sortedItems.filter(isItemComplete).length;
    const lastIngredient = sortedItems.some(i => (i.component?.name || '').toUpperCase().includes('FRUCTOSA')) ? 'Fructosa' : 'Glucosa';

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-2 pb-28 px-3 overflow-auto">

            {/* ═══ AGUA SECTION ═══ */}
            {aguaItem && (
                <div className={`rounded-2xl overflow-hidden mb-4 shadow-md transition-all ${
                    aguaComplete ? 'border-2 border-green-400' : 'border-2 border-blue-400'
                }`}>
                    {/* Water header */}
                    <div className={`p-3 flex items-center gap-3 ${aguaComplete ? 'bg-green-500' : 'bg-gradient-to-r from-blue-600 to-cyan-500'}`}>
                        <div className="h-9 w-9 rounded-full bg-white/20 flex items-center justify-center">
                            {aguaComplete ? <CheckCircle size={22} className="text-white" /> : <Droplets size={22} className="text-white" />}
                        </div>
                        <div className="flex-1">
                            <div className="text-white font-black text-sm">1. AGUA</div>
                            <div className="text-white/70 text-[10px] font-bold">
                                {aguaComplete ? '✅ Completado' : waterStartedAt ? `Llenando... ${waterElapsed}` : 'Pendiente de iniciar'}
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-white font-black text-lg">{fmtQty(aguaItem.plannedQuantity || 0, aguaItem.unit)}</div>
                            {aguaItem && lotNumbers[aguaItem.id] && (
                                <div className="text-white/60 text-[9px]">Lote: {lotNumbers[aguaItem.id]}</div>
                            )}
                        </div>
                    </div>

                    {/* Water body */}
                    <div className="bg-white p-4">
                        {!waterStartedAt && aguaActual === 0 ? (
                            <button
                                onClick={handleStartWater}
                                className="w-full flex items-center justify-center gap-3 py-5 rounded-2xl
                                    bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-black text-lg
                                    shadow-lg hover:shadow-xl active:scale-95 transition-all"
                            >
                                <Play size={28} fill="white" />
                                INICIAR LLENADO DE AGUA
                            </button>
                        ) : (
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 flex-shrink-0">
                                    <Droplets size={18} className={`text-blue-500 ${aguaComplete ? '' : 'animate-bounce'}`} />
                                    <span className={`text-lg font-black ${aguaComplete ? 'text-green-600' : 'text-blue-600'}`}>{waterElapsed}</span>
                                </div>
                                <input
                                    type="number" inputMode="decimal"
                                    value={actualQuantities[aguaItem.id] ?? ''}
                                    onChange={(e) => onActualQtyChange(aguaItem.id, e.target.value)}
                                    placeholder={`Peso final (${(aguaItem.plannedQuantity || 0).toLocaleString()})`}
                                    className={`flex-1 text-center text-base font-black py-2 px-3 rounded-xl border-2 focus:ring-2 focus:outline-none ${
                                        aguaComplete ? 'border-green-300 bg-green-50 focus:ring-green-200 text-green-700' : 'border-blue-200 bg-blue-50/50 focus:ring-blue-200 text-blue-700'
                                    }`}
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ═══ ORDER BANNER ═══ */}
            <div className="bg-gradient-to-r from-slate-700 to-slate-600 rounded-xl px-4 py-2.5 mb-4 flex items-center gap-3 shadow">
                <div className="text-white text-[10px] font-bold uppercase tracking-wider flex-1 text-center">
                    Orden de adición: Agua → Ácido Cítrico → Azúcar → {lastIngredient}
                </div>
                <div className="bg-white/20 rounded-full px-2.5 py-1 text-white text-xs font-black">
                    {completedCount}/{sortedItems.length}
                </div>
            </div>

            {/* ═══ OTHER INGREDIENTS ═══ */}
            <div className="space-y-4">
                {otherItems.map((item) => {
                    const info = getIngredientOrder(item.component?.name);
                    const completed = isItemComplete(item);
                    const planned = item.plannedQuantity || 0;
                    const actualQty = actualQuantities[item.id] ?? '';
                    const actual = parseFloat(actualQty) || 0;
                    const MAX_ALLOWED = planned > 0 ? planned * 1.20 : Infinity;
                    const deviation = planned > 0 && actual > 0 ? (((actual - planned) / planned) * 100).toFixed(1) : null;
                    const isOverOrUnder = deviation !== null ? Math.abs(parseFloat(deviation)) > 5 : false;
                    const photoUrl = itemPhotos[item.id] || weighingPhotos[item.id] || note?.processParameters?.weighing_photos?.[item.id];
                    const lots = availableLotsMap[item.id] || [];
                    const currentSel = lotSelections[item.id] || [];
                    const selectedLotIds = new Set(currentSel.map(s => s.lotId));
                    const totalCovered = currentSel.reduce((s, sel) => s + (sel.qty || 0), 0);
                    const isFullyCovered = totalCovered >= planned * 0.97 || useManualLotMap[item.id];
                    const unselectedLots = lots.map(lot => {
                        const rawQty = lot.unit === 'kg' || lot.unit === 'KG' ? lot.currentQuantity * 1000 : lot.currentQuantity;
                        return { ...lot, effectiveQty: rawQty };
                    }).filter(l => l.effectiveQty > 0 && !selectedLotIds.has(l.id));

                    const borderColor = completed ? 'border-green-400'
                        : info.color === 'orange' ? 'border-orange-300'
                        : info.color === 'amber' ? 'border-amber-300'
                        : 'border-purple-300';
                    const badgeBg = completed ? 'bg-green-500'
                        : info.color === 'orange' ? 'bg-gradient-to-br from-orange-500 to-amber-400'
                        : info.color === 'amber' ? 'bg-gradient-to-br from-amber-500 to-yellow-400'
                        : 'bg-gradient-to-br from-purple-600 to-violet-500';

                    return (
                        <div key={item.id} className={`rounded-2xl border-2 ${borderColor} bg-white overflow-hidden shadow-sm transition-all ${completed ? 'opacity-80' : ''}`}>
                            {/* Header row */}
                            <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-100">
                                <div className={`h-8 w-8 rounded-lg ${badgeBg} text-white flex items-center justify-center font-black text-sm shadow-sm`}>
                                    {completed ? <CheckCircle size={18} /> : info.order}
                                </div>
                                <div className="flex-1">
                                    <div className="text-sm font-black text-slate-800">{item.component?.name || 'Material'}</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-base font-black text-slate-700">{fmtQty(planned, item.unit)}</div>
                                    {deviation !== null && (
                                        <div className={`text-[10px] font-bold ${isOverOrUnder ? 'text-amber-600' : 'text-green-600'}`}>
                                            {parseFloat(deviation) > 0 ? `+${deviation}%` : `${deviation}%`}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Fields */}
                            <div className="p-4 space-y-3">
                                {/* Row 1: Weight input + Photo */}
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number" inputMode="decimal"
                                        value={actualQty}
                                        onChange={(e) => onActualQtyChange(item.id, e.target.value)}
                                        onBlur={(e) => {
                                            const val = parseFloat(e.target.value);
                                            if (planned > 0 && !isNaN(val) && val > MAX_ALLOWED) {
                                                onActualQtyChange(item.id, String(parseFloat(MAX_ALLOWED.toFixed(2))));
                                            }
                                        }}
                                        placeholder={planned.toLocaleString()}
                                        className={`flex-1 text-center text-sm font-black py-2 px-3 rounded-lg border-2 focus:outline-none focus:ring-1 transition-all ${
                                            actual > 0
                                                ? isOverOrUnder ? 'border-amber-300 bg-amber-50 focus:ring-amber-200 text-amber-700' : 'border-green-300 bg-green-50 focus:ring-green-200 text-green-700'
                                                : 'border-slate-200 bg-slate-50 focus:ring-slate-200 text-slate-700'
                                        }`}
                                    />
                                    <label className={`flex items-center justify-center gap-1 px-3 py-2 rounded-lg border-2 border-dashed cursor-pointer transition-all active:scale-95 flex-shrink-0 ${
                                        photoUrl ? 'border-emerald-300 bg-emerald-50 text-emerald-600' : 'border-red-300 bg-red-50 text-red-500'
                                    }`}>
                                        {photoUrl ? <CheckCircle size={14} /> : <Camera size={14} />}
                                        <span className="font-bold text-[10px]">{photoUrl ? 'OK' : 'FOTO'}</span>
                                        <input type="file" accept="image/*" capture="environment" className="sr-only"
                                            onChange={(e) => handlePhotoCapture(item, e)} />
                                    </label>
                                </div>

                                {/* Row 2: Lot selector */}
                                <div>
                                    {lots.length > 0 && !useManualLotMap[item.id] ? (
                                        <>
                                            {currentSel.length > 0 ? (
                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-center">
                                                        <span className="font-bold text-emerald-800 text-xs">{currentSel.map(s => s.lotNumber).join(' + ')}</span>
                                                    </div>
                                                    <button onClick={() => removeLotSelection(item, currentSel[0]?.lotId)}
                                                        className="p-1.5 rounded-lg hover:bg-red-100 text-red-400 flex-shrink-0">
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="relative">
                                                    <select value="" onChange={(e) => handleLotSelect(item, e.target.value)}
                                                        className="w-full text-center text-xs font-bold py-2 px-3 rounded-lg border
                                                            border-indigo-200 bg-indigo-50 focus:ring-1 focus:ring-indigo-200 focus:outline-none
                                                            text-indigo-700 appearance-none cursor-pointer">
                                                        <option value="">— Seleccionar Lote —</option>
                                                        {unselectedLots.map(lot => (
                                                            <option key={lot.id} value={lot.id}>
                                                                {lot.lotNumber} — {fmtQty(lot.effectiveQty, item.unit)}
                                                            </option>
                                                        ))}
                                                        <option value="__manual__">✏️ Manual</option>
                                                    </select>
                                                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none" size={14} />
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <input type="text" value={lotNumbers[item.id] || ''}
                                            onChange={(e) => onLotNumberChange?.(item.id, e.target.value)}
                                            placeholder="Nº Lote"
                                            className="w-full text-center text-xs font-bold py-2 px-3 rounded-lg border
                                                border-slate-200 bg-slate-50 focus:ring-1 focus:ring-slate-200 focus:outline-none text-slate-700 uppercase" />
                                    )}
                                </div>

                                {/* Photo preview */}
                                {photoUrl && (
                                    <img src={photoUrl} alt="Pesaje"
                                        className="w-full max-h-20 object-cover rounded-xl border-2 border-emerald-200 shadow-sm" />
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default PesajeBatchStep;
