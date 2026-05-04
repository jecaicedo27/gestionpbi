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

// Formato máximo 1 decimal para cantidades
const round1 = (q) => Math.round(q * 10) / 10;
const fmt1 = (q) => round1(q).toLocaleString('es-CO', { maximumFractionDigits: 1 });

const fmtQty = (q, unit) => {
    const weightUnits = ['g', 'gramo', 'gramos', 'kg'];
    if (unit && !weightUnits.includes((unit || '').toLowerCase())) return `${fmt1(q)} ${unit}`;
    if (q >= 1000) return `${fmt1(q)} g (${round1(q / 1000)} kg)`;
    return `${fmt1(q)} g`;
};

const fmtQtyShort = (q, unit) => {
    const weightUnits = ['gramo', 'gramos', 'g', 'kg', 'kilogramo', 'kilogramos', 'kilo', 'kilos'];
    if (unit && !weightUnits.includes((unit || '').toLowerCase())) {
        return `${fmt1(q)} ${unit}`;
    }
    return q >= 1000 ? `${round1(q / 1000)} kg` : `${fmt1(q)} g`;
};
const unitShort = (unit) => {
    const weightUnits = ['gramo', 'gramos', 'g', 'kg', 'kilogramo', 'kilogramos', 'kilo', 'kilos'];
    if (unit && !weightUnits.includes((unit || '').toLowerCase())) return unit;
    return 'g';
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
    const sortedItems = useMemo(() => {
        // Si todos los items tienen displayOrder definido (viene de la fórmula
        // del producto vía assemblyTemplateStageInput), respetamos ese orden.
        // Cae a orden hardcoded solo cuando no hay displayOrder.
        const arr = [...items];
        const allHaveDisplayOrder = arr.every(i => i.displayOrder != null);
        if (allHaveDisplayOrder) {
            return arr.sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999));
        }
        return arr.sort((a, b) => getIngredientOrder(a.component?.name).order - getIngredientOrder(b.component?.name).order);
    }, [items]);

    const aguaItem = useMemo(() => sortedItems.find(i => (i.component?.name || '').toUpperCase().includes('AGUA')), [sortedItems]);
    const otherItems = useMemo(() => sortedItems.filter(i => !(i.component?.name || '').toUpperCase().includes('AGUA')), [sortedItems]);

    const [itemPhotos, setItemPhotos] = useState({});
    const [availableLotsMap, setAvailableLotsMap] = useState({});
    const [useManualLotMap, setUseManualLotMap] = useState({});
    const [modalPhoto, setModalPhoto] = useState(null);

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
        const nameU = (item.component?.name || '').toUpperCase();
        const isAgua = nameU.includes('AGUA');
        // Insumos intermedios (BASE LIQUIPOPS, BASE SIROPE, BASE ESCARCHADOR,
        // ALGINATO PREPARADO, COMPUESTO X, PROTECCION X, PREMEZCLA X, PROTONICO,
        // SABORIZACION X) ya vienen pesados del stage anterior del mismo bache —
        // no requieren foto del operario.
        const isIntermediate = nameU.startsWith('BASE ') ||
            nameU.startsWith('ALGINATO PREPARADO') ||
            nameU.startsWith('COMPUESTO') ||
            nameU.startsWith('PROTECCION') ||
            nameU.startsWith('PREMEZCLA') ||
            nameU.startsWith('PROTONICO') ||
            nameU.startsWith('SABORIZACION');
        const hasQty = actualQuantities[item.id] !== undefined && actualQuantities[item.id] !== '';
        const hasLot = !!lotNumbers[item.id]?.trim();
        const hasPhoto = !!(itemPhotos[item.id] || weighingPhotos[item.id] || note?.processParameters?.weighing_photos?.[item.id]);
        if (isAgua || isIntermediate) return hasQty && hasLot;
        return hasQty && hasLot && hasPhoto;
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

    const productName = note?.product?.name || 'Producto';
    const totalItems = sortedItems.length;
    const completedItems = sortedItems.filter(isItemComplete).length;

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-2 pb-44 px-3 overflow-auto">
            {/* Header — producto + progreso de pesaje */}
            <div className="bg-gradient-to-r from-purple-600 to-violet-500 rounded-lg px-3 py-2 mb-2 shadow flex items-center justify-between gap-3">
                <div className="text-white font-black text-sm whitespace-nowrap">⚖️ PESAR INGREDIENTES</div>
                <div className="text-white/90 text-xs font-bold truncate flex-1 text-center">{productName}</div>
                <div className="text-white/90 text-xs font-black whitespace-nowrap">{completedItems}/{totalItems}</div>
            </div>

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
                            {/* AGUA: planificado redondeado a entero (no maneja decimales) */}
                            <div className="text-white font-black text-xl">{Math.round((aguaItem.plannedQuantity || 0) / 1000).toLocaleString()} kg</div>
                            <div className="text-white/80 text-sm font-bold">{Math.round(aguaItem.plannedQuantity || 0).toLocaleString()} g</div>
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
                                <div className="flex-1">
                                    <input
                                        type="number" inputMode="numeric" step="1" min="0"
                                        value={actualQuantities[aguaItem.id] ?? ''}
                                        onChange={(e) => {
                                            // AGUA: solo enteros (sin decimales)
                                            const v = e.target.value.replace(/[.,]/g, '');
                                            onActualQtyChange(aguaItem.id, v);
                                        }}
                                        onBlur={(e) => {
                                            // Forzar entero al perder foco
                                            const v = parseFloat(e.target.value);
                                            if (!isNaN(v)) onActualQtyChange(aguaItem.id, String(Math.round(v)));
                                        }}
                                        placeholder={`Peso en gramos (${Math.round(aguaItem.plannedQuantity || 0).toLocaleString()})`}
                                        className={`w-full text-center text-xl font-black py-3 px-4 rounded-xl border-2 focus:ring-2 focus:outline-none ${
                                            aguaComplete ? 'border-green-300 bg-green-50 focus:ring-green-200 text-green-700' : 'border-blue-200 bg-blue-50/50 focus:ring-blue-200 text-blue-700'
                                        }`}
                                    />
                                    {(() => {
                                        const val = parseFloat(actualQuantities[aguaItem.id]);
                                        const planned = aguaItem.plannedQuantity || 0;
                                        if (!isNaN(val) && val > 0 && planned > 0) {
                                            const pct = ((val - planned) / planned * 100).toFixed(1);
                                            const tooLow = val < planned * 0.80;
                                            return (
                                                <div className="flex items-center justify-between mt-1 px-1">
                                                    <span className="text-[10px] font-bold text-slate-400">{fmtQtyShort(val)}</span>
                                                    {tooLow && <span className="text-[10px] font-black text-red-600 animate-pulse">⚠ Muy por debajo del requerido</span>}
                                                    {!tooLow && <span className={`text-[10px] font-bold ${Math.abs(pct) > 5 ? 'text-amber-600' : 'text-green-600'}`}>{pct > 0 ? `+${pct}%` : `${pct}%`}</span>}
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ═══ OTHER INGREDIENTS ═══ — grid 2 columnas en pantallas md+ */}
            <div className="grid grid-cols-2 gap-2">
                {otherItems.map((item) => {
                    const info = getIngredientOrder(item.component?.name);
                    const completed = isItemComplete(item);
                    const planned = item.plannedQuantity || 0;
                    const actualQty = actualQuantities[item.id] ?? '';
                    const actual = parseFloat(actualQty) || 0;
                    const MAX_ALLOWED = planned > 0 ? planned * 1.20 : Infinity;
                    const deviation = planned > 0 && actual > 0 ? (((actual - planned) / planned) * 100).toFixed(1) : null;
                    const isOverOrUnder = deviation !== null ? Math.abs(parseFloat(deviation)) > 5 : false;
                    const tooLow = planned > 0 && actual > 0 && actual < planned * 0.80;
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
                        <div key={item.id} className={`rounded-lg border ${borderColor} bg-white overflow-hidden shadow-sm transition-all ${completed ? 'opacity-80' : ''}`}>
                            {/* Header row — más denso */}
                            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 border-b border-slate-100">
                                <div className={`h-6 w-6 rounded ${badgeBg} text-white flex items-center justify-center font-black text-xs shadow-sm shrink-0`}>
                                    {completed ? <CheckCircle size={14} /> : info.order}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-black text-slate-800 truncate">{item.component?.name || 'Material'}</div>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="text-sm font-black text-slate-700 leading-tight">{fmtQtyShort(planned, item.unit)}</div>
                                    <div className="text-[10px] font-semibold text-slate-500 leading-tight">{fmt1(planned)} {unitShort(item.unit)}
                                        {deviation !== null && (
                                            <span className={`ml-1 font-black ${isOverOrUnder ? 'text-amber-600' : 'text-green-600'}`}>
                                                {parseFloat(deviation) > 0 ? `+${deviation}%` : `${deviation}%`}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Fields — más densos */}
                            <div className="p-2 space-y-1.5">
                                {/* Row 1: Weight input + Photo */}
                                <div className="flex items-center gap-1.5">
                                    <div className="flex-1">
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
                                            placeholder={`${fmt1(planned)} ${unitShort(item.unit)}`}
                                            className={`w-full text-center text-base font-black py-1.5 px-2 rounded-md border focus:outline-none focus:ring-1 transition-all ${
                                                actual > 0
                                                    ? tooLow ? 'border-red-400 bg-red-50 focus:ring-red-200 text-red-700'
                                                    : isOverOrUnder ? 'border-amber-300 bg-amber-50 focus:ring-amber-200 text-amber-700'
                                                    : 'border-green-300 bg-green-50 focus:ring-green-200 text-green-700'
                                                    : 'border-slate-200 bg-slate-50 focus:ring-slate-200 text-slate-700'
                                            }`}
                                        />
                                        {actual > 0 && tooLow && (
                                            <div className="text-[9px] font-black text-red-600 animate-pulse text-center mt-0.5">⚠ Muy por debajo ({deviation}%)</div>
                                        )}
                                    </div>
                                    {!(() => {
                                        const n = (item.component?.name || '').toUpperCase();
                                        return n.startsWith('BASE ') || n.startsWith('ALGINATO PREPARADO') ||
                                               n.startsWith('COMPUESTO') || n.startsWith('PROTECCION') ||
                                               n.startsWith('PREMEZCLA') || n.startsWith('PROTONICO') ||
                                               n.startsWith('SABORIZACION');
                                    })() && (
                                        <label className={`flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md border border-dashed cursor-pointer transition-all active:scale-95 flex-shrink-0 ${
                                            photoUrl ? 'border-emerald-300 bg-emerald-50 text-emerald-600' : 'border-red-300 bg-red-50 text-red-500'
                                        }`}>
                                            {photoUrl ? <CheckCircle size={14} /> : <Camera size={14} />}
                                            <span className="font-bold text-[10px]">{photoUrl ? 'OK' : 'FOTO'}</span>
                                            <input type="file" accept="image/*" capture="environment" className="sr-only"
                                                onChange={(e) => handlePhotoCapture(item, e)} />
                                        </label>
                                    )}
                                </div>

                                {/* Row 2: Lot selector */}
                                <div>
                                    {lots.length > 0 && !useManualLotMap[item.id] ? (
                                        <div className="space-y-1">
                                            {/* Selected lots — compactos */}
                                            {currentSel.map((sel, idx) => (
                                                <div key={sel.lotId || idx} className="flex items-center gap-1">
                                                    <div className="flex-1 bg-emerald-100 border border-emerald-400 rounded-md px-2 py-1 text-center">
                                                        <span className="text-[9px] font-bold text-emerald-500 uppercase mr-1">
                                                            Lote{currentSel.length > 1 ? ` ${idx + 1}` : ''}:
                                                        </span>
                                                        <span className="font-black text-emerald-800 text-xs">
                                                            {sel.lotNumber || lotNumbers[item.id]?.split(' + ')[idx] || '—'}
                                                        </span>
                                                        {sel.qty != null && (
                                                            <span className="text-emerald-600 text-[10px] font-bold ml-1">({fmt1(sel.qty)} {unitShort(item.unit)})</span>
                                                        )}
                                                    </div>
                                                    <button onClick={() => removeLotSelection(item, sel.lotId)}
                                                        className="p-1 rounded hover:bg-red-100 text-red-400 flex-shrink-0">
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ))}
                                            {/* Coverage info + add more */}
                                            {currentSel.length > 0 && !isFullyCovered && unselectedLots.length > 0 && (
                                                <div className="text-center text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                                                    ⚠ Faltan {(planned - totalCovered).toLocaleString()}g — selecciona otro lote
                                                </div>
                                            )}
                                            {/* Lot selector (show when no lots selected OR when more needed) */}
                                            {(currentSel.length === 0 || (!isFullyCovered && unselectedLots.length > 0)) && (
                                                <div className="relative">
                                                    <select value="" onChange={(e) => handleLotSelect(item, e.target.value)}
                                                        className="w-full text-center text-xs font-bold py-1.5 px-2 rounded-md border
                                                            border-indigo-300 bg-indigo-50 focus:ring-1 focus:ring-indigo-200 focus:outline-none
                                                            text-indigo-700 appearance-none cursor-pointer">
                                                        <option value="">{currentSel.length > 0 ? '— Agregar otro lote —' : '— Seleccionar Lote —'}</option>
                                                        {unselectedLots.map(lot => (
                                                            <option key={lot.id} value={lot.id}>
                                                                {lot.lotNumber} — {fmtQty(lot.effectiveQty, item.unit)}
                                                            </option>
                                                        ))}
                                                        <option value="__manual__">✏️ Manual</option>
                                                    </select>
                                                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none" size={12} />
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <input type="text" value={lotNumbers[item.id] || ''}
                                            onChange={(e) => onLotNumberChange?.(item.id, e.target.value)}
                                            placeholder="Nº Lote"
                                            className="w-full text-center text-xs font-bold py-1.5 px-2 rounded-md border
                                                border-slate-300 bg-slate-50 focus:ring-1 focus:ring-slate-200 focus:outline-none text-slate-700 uppercase" />
                                    )}
                                </div>

                                {/* Photo preview */}
                                {photoUrl && (
                                    <img src={photoUrl} alt="Pesaje" onClick={() => setModalPhoto(photoUrl)}
                                        className="w-full max-h-20 object-cover rounded-xl border-2 border-emerald-200 shadow-sm cursor-pointer active:scale-95 transition-transform" />
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {modalPhoto && (
                <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
                    onClick={() => setModalPhoto(null)}>
                    <button onClick={() => setModalPhoto(null)}
                        className="absolute top-4 right-4 bg-white/20 hover:bg-white/40 rounded-full p-2">
                        <X size={28} className="text-white" />
                    </button>
                    <img src={modalPhoto} alt="Foto ampliada"
                        onClick={(e) => e.stopPropagation()}
                        className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl" />
                </div>
            )}
        </div>
    );
};

export default PesajeBatchStep;
