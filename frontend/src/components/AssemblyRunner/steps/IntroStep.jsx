import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';

const parseStored = (value, fallback) => {
    if (typeof value !== 'string') return value ?? fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const asStoredObject = (value) => {
    const parsed = parseStored(value, {});
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};

const asStoredArray = (value) => {
    const parsed = parseStored(value, []);
    return Array.isArray(parsed) ? parsed : [];
};

const quantityInGrams = (quantity, unit) => {
    const value = Number(quantity);
    if (!Number.isFinite(value)) return 0;
    const normalizedUnit = String(unit || '').toLowerCase();
    if (normalizedUnit === 'kg') return value * 1000;
    if (['g', 'gr', 'gramo', 'gramos'].includes(normalizedUnit)) return value;
    return 0;
};

const pesajeItemsTotalGrams = (note) => {
    const itemTotal = (note?.items || []).reduce((sum, item) => {
        const quantity = item.actualQuantity ?? item.plannedQuantity;
        return sum + quantityInGrams(quantity, item.unit);
    }, 0);
    if (itemTotal > 0) return itemTotal;
    return quantityInGrams(note?.actualQuantity ?? note?.targetQuantity, note?.unit);
};

/**
 * IntroStep — redesigned with card + gradient header style.
 * Shows production context, batch info, materials list, and production target.
 * For EMPAQUE notes with multiple presentations: shows a selection grid.
 */
const IntroStep = ({
    note,
    allBatchNotes = [],
    targetQuantityValue = '',
    onTargetQtyChange,
    esferaOutputFactor = 1.1,
    onSkipToEmpaque,
    empaqueReceptionConfirmed = false,
    savedReceptionPhotos = {},
    onReceptionConfirm,
    carriots = [],
}) => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const isAdmin = user?.role === 'ADMIN';
    const noteData = note;
    const isAlreadyStarted = noteData.status === 'EXECUTING';

    const processCode = noteData.processType?.code;
    const isPesaje = ['PESAJE', 'G_PESAJE'].includes(processCode);
    const isFormacion = ['FORMACION', 'G_FORMACION'].includes(processCode);
    const isEnsamble = ['ENSAMBLE', 'G_ENSAMBLE'].includes(processCode);
    const isConteo = ['CONTEO', 'G_CONTEO'].includes(processCode);
    const isEmpaque = ['EMPAQUE', 'G_EMPAQUE'].includes(processCode);

    const outputTargets = noteData.productionBatch?.outputTargets || [];

    // ── FORMACION meta ──────────────────────────────────────────────────────
    // Uses targetQuantity from backend (= formula.baseQuantity, e.g. 150,000g).
    //
    // Factor de Rendimiento (DESHABILITADO — ahora se usa la fórmula directamente):
    //   esferaOutputFactor = 1.25 (alginato aporta ~25% masa extra)
    //   Cálculo: Esferas = Compuesto × 1.25
    //   Ej: 122,518g compuesto × 1.25 = 153,147g esferas
    //   Si se necesita reactivar:
    //     const compuestoItem = noteData.items?.find(it =>
    //         it.component?.name?.toUpperCase().includes('COMPUESTO'));
    //     const baseQty = noteData.compuestoActualQty || compuestoItem?.plannedQuantity;
    //     formacionMeta = baseQty ? (baseQty * 1.25).toFixed(0) : noteData.targetQuantity;
    let formacionMeta = null;
    if (isFormacion) {
        formacionMeta = noteData.targetQuantity || null;
    }

    // ── ENSAMBLE meta ───────────────────────────────────────────────────────
    let ensambleMeta = null;
    let ensambleMetaUnit = 'uds';
    if (isEnsamble) {
        const stageName = (noteData.stageName || '').toLowerCase();
        const nums = (stageName.match(/\d{3,}/g) || []);
        const target = outputTargets.find(t => {
            const pName = (t.product?.name || t.product?.sku || '').toLowerCase();
            return nums.some(n => pName.includes(n));
        }) || (outputTargets.length === 1 ? outputTargets[0] : null);

        if (target?.plannedUnits && target.plannedUnits < 50000) {
            // Final product ENSAMBLE (unit-based, e.g. 160 tarros)
            ensambleMeta = target.plannedUnits;
            ensambleMetaUnit = 'uds';
        } else if (noteData.targetQuantity) {
            // Weight-based ENSAMBLE (e.g. PROTECCION 108,000g, BASE 240,000g)
            ensambleMeta = noteData.targetQuantity;
            ensambleMetaUnit = noteData.unit || 'g';
        }

        // Fallback: sum of note's own weight items (always available on first render)
        if (!ensambleMeta && noteData.items?.length > 0) {
            const weightUnits = ['g', 'kg', 'gramo', 'gramos'];
            const total = noteData.items.reduce((sum, item) => {
                if (!weightUnits.includes(item.unit)) return sum;
                const qty = item.plannedQuantity || 0;
                return sum + (item.unit === 'kg' ? qty * 1000 : qty);
            }, 0);
            if (total > 0) {
                ensambleMeta = Math.round(total);
                ensambleMetaUnit = 'g';
            }
        }
    }

    // ── EMPAQUE meta ────────────────────────────────────────────────────────
    let empaquePlanned = null;
    let empaqueConteo = null;
    if (isEmpaque) {
        const stageName = (noteData.stageName || '').toLowerCase();
        const nums = (stageName.match(/\d{3,}/g) || []);
        const target = outputTargets.find(t => {
            const pName = (t.product?.name || '').toLowerCase();
            return nums.some(n => pName.includes(n));
        }) || (outputTargets.length === 1 ? outputTargets[0] : null);
        empaquePlanned = target?.plannedUnits ?? null;
        empaqueConteo = noteData.empaqueData?.conteo_qty ?? null;
    }

    // ── EMPAQUE material availability check ─────────────────────────────────
    const [materialStatus, setMaterialStatus] = useState(null); // null=loading, []=all ok, [{name, required, available}]=missing
    useEffect(() => {
        if (!isEmpaque || !noteData.items?.length) return;
        const exemptKeywords = ['ETIQUETA', 'SELLO', 'CAJA'];
        const itemsToCheck = noteData.items.filter(item => {
            const name = (item.component?.name || '').toUpperCase();
            return !exemptKeywords.some(kw => name.includes(kw));
        });
        if (itemsToCheck.length === 0) { setMaterialStatus([]); return; }

        const token = localStorage.getItem('token');
        Promise.all(itemsToCheck.map(item =>
            fetch(`/api/inventory/lots?productId=${item.componentId || item.component?.id}&status=AVAILABLE,LOW_STOCK&zone=PRODUCTION`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            .then(r => r.json())
            .then(lots => {
                const available = Array.isArray(lots)
                    ? lots.reduce((sum, l) => sum + (l.currentQuantity || 0), 0)
                    : 0;
                return { name: item.component?.name, required: item.plannedQuantity || 0, unit: item.unit, available };
            })
            .catch(() => ({ name: item.component?.name, required: item.plannedQuantity || 0, unit: item.unit, available: 0 }))
        )).then(results => {
            const missing = results.filter(r => r.available < r.required);
            setMaterialStatus(missing);
        });
    }, [isEmpaque, noteData.id]);

    // ── EMPAQUE multi-presentation selector ─────────────────────────────────
    // ── Manual conteo state for siropes (no CONTEO step) ──
    const [manualConteo, setManualConteo] = useState({});
    const [savingConteo, setSavingConteo] = useState(false);
    // ── Reception photo state (must be at top level per Rules of Hooks) ──
    const [receptionPhotos, setReceptionPhotos] = useState(savedReceptionPhotos);
    const [uploadingReception, setUploadingReception] = useState({});

    // Restore saved photos from backend when they arrive (async load)
    useEffect(() => {
        if (savedReceptionPhotos && Object.keys(savedReceptionPhotos).length > 0) {
            setReceptionPhotos(prev => ({ ...savedReceptionPhotos, ...prev }));
        }
    }, [JSON.stringify(savedReceptionPhotos)]); // eslint-disable-line
    // ── Admin edit state for Real Producido ──
    const [adminEditingProduct, setAdminEditingProduct] = useState(null); // productId being edited
    const [adminEditValue, setAdminEditValue] = useState('');
    const [adminSaving, setAdminSaving] = useState(false);
    const [addingPresentation, setAddingPresentation] = useState(false);
    const [availableProducts, setAvailableProducts] = useState([]);
    const [loadingProducts, setLoadingProducts] = useState(false);
    // ── Photo modal state ──
    const [photoModal, setPhotoModal] = useState(null); // { url, label }

    if (isEmpaque) {
        const empaqueNotes = allBatchNotes
            .filter(n => ['EMPAQUE', 'G_EMPAQUE'].includes(n.processType?.code))
            .sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0));

        // Check if there's a CONTEO step in this batch (perlas have it, siropes don't)
        const hasConteoStep = allBatchNotes.some(n => ['CONTEO', 'G_CONTEO'].includes(n.processType?.code));

        // ── Geniality detection: batch uses carriots-based reception ──
        // If the CONTEO note has carriots data, this is a Geniality batch.
        // Geniality reception is handled by GConteoCarritosStep, NOT this table.
        const conteoNoteForCheck = allBatchNotes.find(n => ['CONTEO', 'G_CONTEO'].includes(n.processType?.code));
        const hasCarriotsSystem = !!(conteoNoteForCheck?.processParameters?.carriots?.length > 0);

        // ── Detect route prefix (Geniality vs Liquipops) ──
        const isGenialityRoute = window.location.pathname.includes('/geniality/');

        // ── Reception screen (before selection) ──
        // Auto-skip if any EMPAQUE note has already been started or completed
        // Also skip for Geniality batches — carriots reception is a separate wizard step
        const anyEmpaqueStarted = empaqueNotes.some(n => n.status === 'COMPLETED' || n.status === 'EXECUTING');
        const showReception = !empaqueReceptionConfirmed && (!anyEmpaqueStarted || isAdmin) && !hasCarriotsSystem;
        if (showReception) {
            const batchNumber = noteData.productionBatch?.batchNumber || '';
            const productName = noteData.product?.name || noteData.stageName || '';

            // For siropes: save manual conteo values to each EMPAQUE note before confirming
            const handleConfirmWithConteo = async () => {
                if (!hasConteoStep && Object.keys(manualConteo).length > 0) {
                    setSavingConteo(true);
                    const token = localStorage.getItem('token');
                    try {
                        for (const en of empaqueNotes) {
                            const realQty = parseInt(manualConteo[en.id], 10);
                            if (!isNaN(realQty) && realQty >= 0) {
                                // Save conteo_qty to the EMPAQUE note's processParameters
                                await fetch(`/api/assembly-notes/${en.id}/process-params`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                    body: JSON.stringify({ processParameters: { empaqueRef: { conteo_qty: realQty, planned_qty: en.targetQuantity } } })
                                });
                            }
                        }
                    } catch (e) {
                        console.error('Error saving conteo:', e);
                    }
                    setSavingConteo(false);
                }
                onReceptionConfirm && onReceptionConfirm(receptionPhotos);
            };

            // Check if all manual conteos are filled (for siropes)
            // A note is considered "filled" if: (a) it has a saved conteo in DB, OR (b) a manual value is in local state
            const allConteoFilled = hasConteoStep || empaqueNotes.every(en => {
                const empData = en.empaqueData || {};
                const empRef = en.processParameters?.empaqueRef || {};
                const savedConteo = empData.conteo_qty ?? empRef.conteo_qty ?? null;
                if (savedConteo !== null) return true; // already saved in DB ✓
                const val = parseInt(manualConteo[en.id], 10);
                return !isNaN(val) && val >= 0;
            });

            // Get conteo photos from CONTEO note
            const conteoNote = allBatchNotes.find(n => ['CONTEO', 'G_CONTEO'].includes(n.processType?.code));
            const parsedProcessParams = typeof conteoNote?.processParameters === 'string' ? JSON.parse(conteoNote.processParameters) : (conteoNote?.processParameters || {});
            const conteoMap = typeof parsedProcessParams.conteo === 'string' ? JSON.parse(parsedProcessParams.conteo) : (parsedProcessParams.conteo || {});
            const targetCarriotsData = typeof parsedProcessParams.carriots === 'string' ? JSON.parse(parsedProcessParams.carriots) : (parsedProcessParams.carriots || []);
            const conteoPhotosMap = typeof parsedProcessParams.conteo_photos === 'string' ? JSON.parse(parsedProcessParams.conteo_photos) : (parsedProcessParams.conteo_photos || {});

            // receptionPhotos and uploadingReception are declared at top level (Rules of Hooks)

            const handleReceptionPhoto = async (productId, file) => {
                if (!file) return;
                setUploadingReception(prev => ({ ...prev, [productId]: true }));
                const localUrl = URL.createObjectURL(file);
                setReceptionPhotos(prev => ({ ...prev, [productId]: localUrl }));
                try {
                    const fd = new FormData();
                    fd.append('photo', file);
                    fd.append('context', `recepcion_${productId}`);
                    const res = await fetch('/api/assembly-notes/upload-photo', { method: 'POST', body: fd });
                    const data = await res.json();
                    if (data.url) setReceptionPhotos(prev => ({ ...prev, [productId]: data.url }));
                } catch (e) {
                    console.error('Error uploading reception photo:', e);
                } finally {
                    setUploadingReception(prev => ({ ...prev, [productId]: false }));
                }
            };

            // Extract size from product name
            const extractSizeLabel = (name) => {
                if (!name) return '';
                const m = name.match(/X\s*(\d+\s*(?:GR|ML|KG))/i);
                return m ? m[1] : '';
            };
            const extractFlavor = (name) => {
                if (!name) return name;
                const m = name.match(/SABOR\s+A\s+(.+?)\s+X\s+/i);
                return m ? m[1] : name;
            };

            // Sort targets by size descending
            const sortedReceptionTargets = [...outputTargets].sort((a, b) => {
                const sA = parseInt((a.product?.name || '').match(/X\s*(\d+)/i)?.[1] || '0', 10);
                const sB = parseInt((b.product?.name || '').match(/X\s*(\d+)/i)?.[1] || '0', 10);
                return sB - sA;
            });

            return (
                <div className="flex flex-col h-full max-w-4xl mx-auto pt-3 pb-36 px-3 animate-in fade-in duration-300">
                    {/* Compact Header */}
                    <div className="rounded-2xl overflow-hidden shadow-xl mb-4"
                        style={{ background: 'linear-gradient(135deg, #ea580c 0%, #dc2626 100%)' }}>
                        <div className="px-5 pt-4 pb-3 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-xl">📦</span>
                                    <span className="text-white/70 text-[10px] font-bold uppercase tracking-[0.2em]">Recepción de Producción</span>
                                </div>
                                <h2 className="text-white font-black text-lg leading-tight">
                                    {extractFlavor(productName) || 'Empaque'}
                                </h2>
                            </div>
                            <div className="bg-white/20 backdrop-blur rounded-xl px-3 py-1.5 text-right">
                                <div className="text-white/60 text-[8px] font-bold uppercase">Lote</div>
                                <div className="text-white font-black text-sm tracking-wide">{batchNumber}</div>
                            </div>
                        </div>
                    </div>

                    {/* ── SECURITY BANNER — Discrepancy Warning ── */}
                    <div className="rounded-2xl overflow-hidden shadow-lg mb-3 border-2 border-red-400"
                        style={{ background: 'linear-gradient(135deg, #fef2f2 0%, #fff1f2 50%, #fef2f2 100%)' }}>
                        <div className="px-4 py-4">
                            <div className="flex items-start gap-3">
                                <span className="text-3xl leading-none mt-0.5">🚨</span>
                                <div>
                                    <div className="text-red-800 font-extrabold text-sm uppercase tracking-wider mb-1.5">AVISO IMPORTANTE — Protocolo de Discrepancias</div>
                                    <div className="text-red-700 text-sm font-semibold leading-snug">
                                        Verifique que las cantidades entregadas coincidan <strong>exactamente</strong> con la columna "Real". 
                                        Si al contar encuentra <strong>diferencias</strong>, NO modifique los datos. 
                                        <span className="text-red-900 font-extrabold">Informe inmediatamente a su jefe de producción.</span>
                                    </div>
                                    <div className="mt-2 text-xs text-red-500 font-bold italic">
                                        Solo personal autorizado (Admin) puede corregir las cantidades reales.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Reception Table */}
                    <div className="bg-white rounded-2xl shadow-lg border-2 border-orange-300 overflow-hidden mb-4 flex-1 flex flex-col">
                        {/* Table Header */}
                        <div className="bg-gradient-to-r from-orange-500 to-red-500 px-4 py-2 text-center shrink-0">
                            <span className="text-white font-extrabold text-xs uppercase tracking-widest">📋 Verificar Entrega de Producción</span>
                        </div>

                        {/* Column Headers */}
                        <div className="grid grid-cols-[70px_1fr_70px_70px_70px_70px] gap-1 px-3 pt-2 pb-1 border-b border-slate-100 shrink-0">
                            <div className="text-[9px] font-bold text-slate-400 uppercase text-center">Tamaño</div>
                            <div className="text-[9px] font-bold text-slate-400 uppercase">Sabor</div>
                            <div className="text-[9px] font-bold text-slate-400 uppercase text-center">Programado</div>
                            <div className="text-[9px] font-bold text-purple-500 uppercase text-center">Real</div>
                            <div className="text-[9px] font-bold text-orange-500 uppercase text-center">Foto Prod.</div>
                            <div className="text-[9px] font-bold text-blue-500 uppercase text-center">Foto Recep.</div>
                        </div>

                        {/* Rows */}
                        <div className="flex-1 overflow-auto px-2 py-1 space-y-1.5">
                            {sortedReceptionTargets.map(target => {
                                const matchingEmpaque = empaqueNotes.find(en => en.productId === target.productId);
                                const empData = matchingEmpaque?.empaqueData || {};
                                const empRef = matchingEmpaque?.processParameters?.empaqueRef || {};
                                const conteoEntry = Object.values(conteoMap).find(c => c.productId === target.productId);

                                // Get carritos data
                                const targetCarriots = (targetCarriotsData || []).filter(c => c.productId === target.productId || c.productId === target.product?.id);
                                const carriotsSum = targetCarriots.length > 0 ? targetCarriots.reduce((sum, c) => sum + Number(c.qty), 0) : null;
                                const carritoPhoto = targetCarriots[0]?.productionPhotoUrl || null;

                                const planned = conteoEntry?.planned ?? empRef.planned_qty ?? empData.planned_qty ?? (target.plannedUnits > 0 ? target.plannedUnits : undefined) ?? null;
                                const draftQty = conteoNote?.processParameters?.conteo_draft?.[target.productId];
                                const conteo = carriotsSum !== null ? carriotsSum : ((conteoEntry?.actual > 0 ? conteoEntry.actual : (draftQty !== undefined ? parseInt(draftQty, 10) : null)) ?? empData.conteo_qty ?? empRef.conteo_qty ?? null);
                                const manualKey = matchingEmpaque?.id || target.productId;
                                const manualVal = manualConteo[manualKey];
                                const displayReal = conteo ?? (manualVal !== undefined ? parseInt(manualVal, 10) : null);
                                const hasNoEmpaque = !matchingEmpaque;

                                const sizeLabel = extractSizeLabel(target.product?.name);
                                const flavor = extractFlavor(target.product?.name);
                                const prodPhoto = conteoPhotosMap[target.productId] || carritoPhoto || null;
                                const recepPhoto = receptionPhotos[target.productId] || null;
                                const isUploadingRecep = uploadingReception[target.productId];

                                const deviation = planned && displayReal != null ? displayReal - planned : 0;
                                const isMatch = displayReal !== null && deviation === 0;
                                const rowBorder = hasNoEmpaque
                                    ? 'border-violet-200 bg-violet-50/50'
                                    : displayReal !== null
                                        ? (isMatch ? 'border-green-200 bg-green-50/30' : 'border-amber-200 bg-amber-50/30')
                                        : 'border-slate-200 bg-slate-50/30';

                                return (
                                    <div key={target.productId} className={`grid grid-cols-[70px_1fr_70px_70px_70px_70px] gap-1 items-center rounded-xl border-2 px-2 py-2 ${rowBorder}`}>
                                        {/* Size */}
                                        <div className="text-center">
                                            <span className="text-[10px] font-bold text-cyan-700 bg-cyan-100 px-2 py-0.5 rounded-full">{sizeLabel}</span>
                                        </div>

                                        {/* Flavor */}
                                        <div>
                                            <span className="text-xs font-bold text-slate-800 leading-tight">{flavor}</span>
                                            {hasNoEmpaque && <span className="ml-1 text-[8px] font-bold text-violet-500 bg-violet-100 px-1 py-0.5 rounded">Sin emp.</span>}
                                        </div>

                                        {/* Programado */}
                                        <div className="text-center">
                                            <div className="text-lg font-black text-slate-500">{planned?.toLocaleString('es-CO') ?? '—'}</div>
                                        </div>

                                        {/* Real — Read-only for operators, editable by Admin */}
                                        <div className="text-center">
                                            {hasConteoStep || conteo !== null ? (
                                                adminEditingProduct === target.productId && isAdmin ? (
                                                    /* Admin inline edit mode — touch-friendly */
                                                    <div className="flex flex-col items-center gap-1">
                                                        <input
                                                            type="number"
                                                            inputMode="numeric"
                                                            min="0"
                                                            autoFocus
                                                            value={adminEditValue}
                                                            onChange={(e) => setAdminEditValue(e.target.value)}
                                                            onFocus={(e) => e.target.select()}
                                                            className="w-28 px-2 py-2 text-2xl font-black text-red-700 bg-white border-3 border-red-400 rounded-xl text-center focus:border-red-500 outline-none"
                                                        />
                                                        <div className="flex gap-1.5">
                                                            {/* Save button */}
                                                            <button
                                                                disabled={adminSaving}
                                                                onClick={async () => {
                                                                    const newVal = parseInt(adminEditValue, 10);
                                                                    if (isNaN(newVal) || newVal < 0) return;
                                                                    setAdminSaving(true);
                                                                    try {
                                                                        const conteoNote = allBatchNotes.find(n => ['CONTEO', 'G_CONTEO'].includes(n.processType?.code));
                                                                        if (conteoNote) {
                                                                            const currentConteo = { ...conteoNote.processParameters?.conteo };
                                                                            const matchKey = Object.keys(currentConteo).find(k => currentConteo[k].productId === target.productId);
                                                                            if (matchKey) {
                                                                                currentConteo[matchKey] = { ...currentConteo[matchKey], actual: newVal };
                                                                                const token = localStorage.getItem('token');
                                                                                await fetch(`/api/assembly-notes/${conteoNote.id}/process-params`, {
                                                                                    method: 'PATCH',
                                                                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                                                                    body: JSON.stringify({ processParameters: { conteo: currentConteo, admin_conteo_edit: { productId: target.productId, oldValue: conteo, newValue: newVal, editedBy: user?.name || user?.email, editedAt: new Date().toISOString() } } })
                                                                                });
                                                                                const matchEmpaque = empaqueNotes.find(en => en.productId === target.productId);
                                                                                if (matchEmpaque) {
                                                                                    await fetch(`/api/assembly-notes/${matchEmpaque.id}/process-params`, {
                                                                                        method: 'PATCH',
                                                                                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                                                                        body: JSON.stringify({ processParameters: { empaque: { conteo_qty: newVal, approved_qty: newVal, defective_qty: 0 } } })
                                                                                    });
                                                                                }
                                                                                const batchId = noteData.productionBatch?.id;
                                                                                if (batchId) {
                                                                                    await fetch(`/api/production/liquipops/batches/${batchId}/output-targets`, {
                                                                                        method: 'PATCH',
                                                                                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                                                                        body: JSON.stringify({ productId: target.productId, actualUnits: newVal })
                                                                                    });
                                                                                }
                                                                                conteoEntry.actual = newVal;
                                                                            }
                                                                        }
                                                                    } catch (err) { console.error('Admin edit error:', err); }
                                                                    setAdminSaving(false);
                                                                    setAdminEditingProduct(null);
                                                                    setAdminEditValue('');
                                                                    window.location.reload();
                                                                }}
                                                                className="w-9 h-9 bg-green-500 hover:bg-green-600 active:scale-95 rounded-xl flex items-center justify-center shadow-md transition-all"
                                                            >
                                                                {adminSaving
                                                                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                                    : <span className="text-white text-lg font-bold">✓</span>
                                                                }
                                                            </button>
                                                            {/* Cancel button */}
                                                            <button
                                                                onClick={() => {
                                                                    setAdminEditingProduct(null);
                                                                    setAdminEditValue('');
                                                                }}
                                                                className="w-9 h-9 bg-slate-400 hover:bg-slate-500 active:scale-95 rounded-xl flex items-center justify-center shadow-md transition-all"
                                                            >
                                                                <span className="text-white text-lg font-bold">✕</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    /* Normal display — with admin edit button */
                                                    <div className="relative group">
                                                        <div className={`text-lg font-black ${isMatch ? 'text-green-600' : 'text-purple-600'}`}>
                                                            {displayReal?.toLocaleString('es-CO') ?? '—'}
                                                        </div>
                                                        {!isMatch && displayReal !== null && displayReal !== 0 && (
                                                            <div className="text-[8px] font-bold text-amber-600">
                                                                {deviation > 0 ? `+${deviation}` : deviation}
                                                            </div>
                                                        )}
                                                        {isAdmin && (
                                                            <button
                                                                onClick={() => {
                                                                    setAdminEditingProduct(target.productId);
                                                                    setAdminEditValue(String(displayReal ?? 0));
                                                                }}
                                                                className="mt-1 px-2 py-0.5 bg-red-500 hover:bg-red-600 active:scale-95 rounded-lg flex items-center justify-center shadow-md transition-all"
                                                                title="Editar conteo (Solo Admin)"
                                                            >
                                                                <span className="text-white text-[10px] font-bold">✏️ Editar</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                )
                                            ) : (
                                                /* Manual input for siropes (no CONTEO step) */
                                                isAdmin ? (
                                                    <input
                                                        type="number"
                                                        inputMode="numeric"
                                                        min="0"
                                                        placeholder={String(planned ?? '')}
                                                        value={manualConteo[manualKey] ?? ''}
                                                        onChange={(e) => setManualConteo(prev => ({ ...prev, [manualKey]: e.target.value }))}
                                                        className="w-full px-1 py-1 text-sm font-black text-purple-700 bg-white border-2 border-purple-300 rounded-lg text-center focus:border-purple-500 outline-none"
                                                    />
                                                ) : (
                                                    <div className="text-lg font-black text-slate-400">—</div>
                                                )
                                            )}
                                        </div>

                                        {/* Foto Producción */}
                                        <div className="flex justify-center">
                                            {prodPhoto ? (
                                                <div className="relative">
                                                    <img
                                                        src={prodPhoto}
                                                        alt={`Prod ${sizeLabel}`}
                                                        className="w-12 h-12 rounded-lg object-cover border-2 border-orange-300 shadow-sm cursor-pointer"
                                                        onClick={() => setPhotoModal({ url: prodPhoto, label: `Foto Producción — ${sizeLabel} ${flavor}` })}
                                                    />
                                                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 rounded-full flex items-center justify-center">
                                                        <span className="text-white text-[8px] font-bold">P</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center">
                                                    <span className="text-slate-300 text-xs">—</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Foto Recepción */}
                                        <div className="flex justify-center">
                                            {recepPhoto ? (
                                                <label className="relative cursor-pointer">
                                                    <img
                                                        src={recepPhoto}
                                                        alt={`Recep ${sizeLabel}`}
                                                        className="w-12 h-12 rounded-lg object-cover border-2 border-blue-400 shadow-sm"
                                                    />
                                                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                                                        <span className="text-white text-[8px] font-bold">✓</span>
                                                    </div>
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        capture="environment"
                                                        className="hidden"
                                                        onChange={(e) => e.target.files?.[0] && handleReceptionPhoto(target.productId, e.target.files[0])}
                                                    />
                                                </label>
                                            ) : (displayReal ?? planned ?? 0) > 0 ? (
                                                <label className={`flex items-center justify-center w-12 h-12 rounded-lg border-2 border-dashed cursor-pointer transition-all
                                                    ${isUploadingRecep
                                                        ? 'border-blue-300 bg-blue-50'
                                                        : 'border-blue-400 bg-blue-50 hover:bg-blue-100 animate-pulse'
                                                    }`}>
                                                    {isUploadingRecep ? (
                                                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                                    ) : (
                                                        <span className="text-blue-500 text-lg">📷</span>
                                                    )}
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        capture="environment"
                                                        className="hidden"
                                                        disabled={isUploadingRecep}
                                                        onChange={(e) => e.target.files?.[0] && handleReceptionPhoto(target.productId, e.target.files[0])}
                                                    />
                                                </label>
                                            ) : (
                                                <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center">
                                                    <span className="text-slate-300 text-xs">—</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Admin: Add Presentation */}
                        {isAdmin && (
                            <div className="px-3 py-2 shrink-0">
                                {!addingPresentation ? (
                                    <button
                                        onClick={async () => {
                                            setAddingPresentation(true);
                                            setLoadingProducts(true);
                                            try {
                                                const existingIds = outputTargets.map(t => t.productId);
                                                const flavor = extractFlavor(noteData.product?.name || '');
                                                const res = await fetch(`/api/products?search=${encodeURIComponent(flavor || '')}&limit=50`, {
                                                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                                                });
                                                const data = await res.json();
                                                const excludeKeywords = ['ETIQUETA', 'SELLO', 'CAJA', 'EMPAQUE', 'INSUMO'];
                                                const products = (data.products || data || []).filter(p => {
                                                    const name = (p.name || '').toUpperCase();
                                                    return !existingIds.includes(p.id)
                                                        && name.includes('LIQUIPOPS')
                                                        && !excludeKeywords.some(kw => name.includes(kw));
                                                });
                                                setAvailableProducts(products);
                                            } catch (e) { console.error(e); }
                                            setLoadingProducts(false);
                                        }}
                                        className="w-full py-2.5 rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold text-sm transition-all active:scale-[0.98]"
                                    >
                                        + Agregar presentación
                                    </button>
                                ) : (
                                    <div className="bg-indigo-50 rounded-xl border-2 border-indigo-200 p-3">
                                        <div className="text-xs font-bold text-indigo-700 mb-2">Seleccione presentación:</div>
                                        {loadingProducts ? (
                                            <div className="text-center text-xs text-slate-400 py-2">Cargando...</div>
                                        ) : availableProducts.length === 0 ? (
                                            <div className="text-center text-xs text-slate-400 py-2">No hay presentaciones adicionales disponibles</div>
                                        ) : (
                                            <div className="space-y-1.5 max-h-40 overflow-auto">
                                                {availableProducts.map(p => (
                                                    <button
                                                        key={p.id}
                                                        onClick={async () => {
                                                            try {
                                                                const token = localStorage.getItem('token');
                                                                const batchId = noteData.productionBatch?.id;
                                                                await fetch(`/api/production/liquipops/batches/${batchId}/output-targets`, {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                                                    body: JSON.stringify({ productId: p.id, plannedUnits: 0, plannedWeightKg: 0 })
                                                                });
                                                                setAddingPresentation(false);
                                                                window.location.reload();
                                                            } catch (e) { console.error('Error adding target:', e); }
                                                        }}
                                                        className="w-full text-left px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 transition-all text-xs font-semibold text-slate-700"
                                                    >
                                                        {p.name}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        <button
                                            onClick={() => { setAddingPresentation(false); setAvailableProducts([]); }}
                                            className="mt-2 w-full py-1.5 rounded-lg bg-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-300 transition-all"
                                        >
                                            Cancelar
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Status Summary */}
                        <div className="px-3 pb-2 shrink-0">
                            {(() => {
                                const allMatch = sortedReceptionTargets.every(t => {
                                    const ce = Object.values(conteoMap).find(c => c.productId === t.productId);
                                    const pl = ce?.planned ?? t.plannedUnits;
                                    const targetCarriots = (conteoNote?.processParameters?.carriots || []).filter(c => c.productId === t.productId);
                                    const carriotsSum = targetCarriots.length > 0 ? targetCarriots.reduce((sum, c) => sum + Number(c.qty), 0) : null;
                                    const actual = carriotsSum !== null ? carriotsSum : ce?.actual;
                                    return actual !== undefined && actual === pl;
                                });
                                // Count products needing reception photos
                                const productsNeedingPhoto = sortedReceptionTargets.filter(t => {
                                    const ce = Object.values(conteoMap).find(c => c.productId === t.productId);
                                    const targetCarriots = (conteoNote?.processParameters?.carriots || []).filter(c => c.productId === t.productId);
                                    const carriotsSum = targetCarriots.length > 0 ? targetCarriots.reduce((sum, c) => sum + Number(c.qty), 0) : null;
                                    const actual = carriotsSum !== null ? carriotsSum : ce?.actual;
                                    return (actual ?? 0) > 0;
                                });
                                const missingPhotos = productsNeedingPhoto.filter(t => !receptionPhotos[t.productId]);
                                return (
                                    <div className="space-y-1.5">
                                        <div className={`rounded-xl p-2.5 text-center text-xs font-bold ${allMatch
                                            ? 'bg-green-50 border border-green-200 text-green-700'
                                            : 'bg-amber-50 border border-amber-200 text-amber-700'
                                        }`}>
                                            {allMatch
                                                ? '✅ Todas las cantidades coinciden con lo programado'
                                                : '⚠️ Hay diferencias entre programado y real producido'}
                                        </div>
                                        {missingPhotos.length > 0 && (
                                            <div className="rounded-xl p-2.5 text-center text-xs font-bold bg-red-50 border border-red-200 text-red-700">
                                                📷 Faltan {missingPhotos.length} foto(s) de recepción — tome foto de cada producto recibido
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Confirm Reception Button */}
                    {(() => {
                        // Check mandatory reception photos: every product with actual > 0 needs a photo
                        const productsNeedingPhoto = sortedReceptionTargets.filter(t => {
                            const ce = Object.values(conteoMap).find(c => c.productId === t.productId);
                            const targetCarriots = (conteoNote?.processParameters?.carriots || []).filter(c => c.productId === t.productId);
                            const carriotsSum = targetCarriots.length > 0 ? targetCarriots.reduce((sum, c) => sum + Number(c.qty), 0) : null;
                            const actual = carriotsSum !== null ? carriotsSum : ce?.actual;
                            return (actual ?? 0) > 0;
                        });
                        const allPhotosUploaded = productsNeedingPhoto.every(t => !!receptionPhotos[t.productId]);
                        const canConfirm = allConteoFilled && allPhotosUploaded && !savingConteo;
                        const missingPhotoCount = productsNeedingPhoto.filter(t => !receptionPhotos[t.productId]).length;
                        return (
                            <>
                                <button
                                    onClick={handleConfirmWithConteo}
                                    disabled={!canConfirm}
                                    className={`w-full py-4 rounded-2xl text-white font-extrabold text-base uppercase tracking-wider shadow-lg transition-all active:scale-[0.98]
                                        ${!canConfirm ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    style={{ background: canConfirm ? 'linear-gradient(135deg, #16a34a 0%, #059669 100%)' : '#94a3b8' }}
                                >
                                    {savingConteo ? '⏳ Guardando...' : '✅ CONFIRMAR RECEPCIÓN DEL CARRITO'}
                                </button>
                                {!allConteoFilled && !hasConteoStep && (
                                    <div className="text-center mt-3 text-xs text-amber-600 font-bold">
                                        ⚠️ Ingrese la cantidad real para todas las presentaciones antes de confirmar
                                    </div>
                                )}
                                {allConteoFilled && !allPhotosUploaded && (
                                    <div className="text-center mt-3 text-xs text-red-600 font-bold">
                                        📷 Tome foto de recepción para {missingPhotoCount} producto(s) antes de confirmar
                                    </div>
                                )}
                            </>
                        );
                    })()}
                </div>
            );
        }

        if (empaqueNotes.length >= 1) {
            const completedCount = empaqueNotes.filter(n => n.status === 'COMPLETED').length;
            const allDone = completedCount === empaqueNotes.length;
            const selectorConteoNote = allBatchNotes.find(n => ['CONTEO', 'G_CONTEO'].includes(n.processType?.code));
            const selectorConteoParams = asStoredObject(selectorConteoNote?.processParameters);
            const fallbackCarriots = asStoredArray(selectorConteoParams.carriots);
            const summaryCarriots = (Array.isArray(carriots) && carriots.length > 0 ? carriots : fallbackCarriots).filter(Boolean);
            const getCarritoProductionPhoto = (carrito) => (
                carrito?.productionPhotoUrl
                || carrito?.dispatchPhoto
                || carrito?.photoProductionUrl
                || null
            );
            const getCarritoReceptionPhoto = (carrito) => (
                carrito?.photoUrl
                || carrito?.receptionPhotoUrl
                || carrito?.receivedPhotoUrl
                || savedReceptionPhotos?.[carrito?.id]
                || null
            );
            const getTargetByProductId = (productId) => outputTargets.find(t =>
                String(t.productId) === String(productId) || String(t.product?.id) === String(productId)
            );
            const carritoProductGroups = summaryCarriots.reduce((acc, carrito) => {
                const key = String(carrito.productId || carrito.productName || 'sin_producto');
                const target = getTargetByProductId(carrito.productId);
                if (!acc[key]) {
                    acc[key] = {
                        productId: carrito.productId,
                        productName: carrito.productName || target?.product?.name || 'Producto sin nombre',
                        items: [],
                    };
                }
                acc[key].items.push(carrito);
                return acc;
            }, {});
            const sortedCarritoGroups = Object.values(carritoProductGroups)
                .map(group => ({
                    ...group,
                    items: [...group.items].sort((a, b) => (a.carritoNum || 0) - (b.carritoNum || 0)),
                }))
                .sort((a, b) => a.productName.localeCompare(b.productName, 'es'));

            return (
                <div className="flex flex-col h-full max-w-4xl mx-auto pt-8 pb-36 px-4">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-12 w-12 rounded-full bg-violet-500 text-white flex items-center justify-center text-2xl shadow-md">📦</div>
                        <div>
                            <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">EMPAQUE · SELECCIÓN</div>
                            <div className="text-xs text-slate-400 mt-0.5">{completedCount} de {empaqueNotes.length} presentaciones completadas</div>
                        </div>
                    </div>
                    <div className="bg-white rounded-3xl shadow-2xl border-4 border-violet-400 overflow-hidden flex-1 flex flex-col">
                        <div className="bg-gradient-to-r from-violet-600 to-purple-500 p-4 text-center">
                            <span className="text-white font-extrabold text-lg uppercase tracking-widest">📦 ¿Qué presentación vas a empacar?</span>
                        </div>

                        {/* Progress bar */}
                        <div className="px-6 pt-4">
                            <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                                <span>Progreso de empaque</span>
                                <span className="font-bold">{completedCount}/{empaqueNotes.length}</span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all duration-500 ${allDone ? 'bg-emerald-500' : 'bg-violet-500'}`}
                                    style={{ width: `${(completedCount / empaqueNotes.length) * 100}%` }}
                                />
                            </div>
                        </div>

                        <div className="flex-1 p-6 space-y-3">
                            {sortedCarritoGroups.length > 0 && (
                                <div className="bg-white border-2 border-teal-200 rounded-2xl overflow-hidden shadow-sm">
                                    <div className="bg-teal-600 px-4 py-3 flex items-center justify-between text-white">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-widest text-teal-100">Resumen de Carritos</div>
                                            <div className="text-sm font-extrabold">Entregas de producción para este lote</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-2xl font-black leading-none">{summaryCarriots.length}</div>
                                            <div className="text-[9px] font-bold uppercase tracking-wider text-teal-100">
                                                {summaryCarriots.length === 1 ? 'carrito' : 'carritos'}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="divide-y divide-teal-100">
                                        {sortedCarritoGroups.map(group => {
                                            const totalQty = group.items.reduce((sum, c) => sum + Number(c.qty || 0), 0);
                                            const receivedCount = group.items.filter(c => c.receivedAt).length;
                                            const target = getTargetByProductId(group.productId);
                                            const planned = target?.plannedUnits;
                                            const pendingQty = planned ? Math.max(0, planned - totalQty) : null;

                                            return (
                                                <div key={group.productId || group.productName} className="p-3 bg-teal-50/30">
                                                    <div className="flex items-start justify-between gap-3 mb-2">
                                                        <div>
                                                            <div className="text-xs font-black text-slate-800 leading-tight">{group.productName}</div>
                                                            <div className="text-[10px] font-bold text-slate-500 mt-0.5">
                                                                {totalQty.toLocaleString('es-CO')} uds recibidas de producción
                                                                {planned ? ` · ${planned.toLocaleString('es-CO')} programadas` : ''}
                                                            </div>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <div className="text-[10px] font-black text-teal-700 bg-teal-100 px-2 py-1 rounded">
                                                                {receivedCount}/{group.items.length} recibidos
                                                            </div>
                                                            {pendingQty !== null && pendingQty > 0 && (
                                                                <div className="text-[9px] font-bold text-amber-600 mt-1">
                                                                    Faltan {pendingQty.toLocaleString('es-CO')} uds
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
                                                        {group.items.map((carrito, idx) => {
                                                            const productionPhoto = getCarritoProductionPhoto(carrito);
                                                            const receptionPhoto = getCarritoReceptionPhoto(carrito);
                                                            const statusLabel = carrito.labeledAt
                                                                ? 'Rotulado'
                                                                : carrito.receivedAt
                                                                    ? 'Recibido'
                                                                    : 'Pendiente';
                                                            const statusClass = carrito.labeledAt
                                                                ? 'bg-indigo-100 text-indigo-700'
                                                                : carrito.receivedAt
                                                                    ? 'bg-emerald-100 text-emerald-700'
                                                                    : 'bg-amber-100 text-amber-700';

                                                            return (
                                                                <div key={carrito.id || `${group.productId}-${idx}`} className="min-w-[150px] bg-white border border-teal-100 rounded-xl p-2 shadow-sm">
                                                                    <div className="flex items-center justify-between gap-2 mb-1.5">
                                                                        <div className="text-[10px] font-black text-slate-700 uppercase">
                                                                            Carrito #{carrito.carritoNum || idx + 1}
                                                                        </div>
                                                                        <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${statusClass}`}>
                                                                            {statusLabel}
                                                                        </span>
                                                                    </div>
                                                                    <div className="text-xl font-black text-teal-700 leading-none">
                                                                        {Number(carrito.qty || 0).toLocaleString('es-CO')}
                                                                        <span className="text-[10px] font-bold text-slate-400 ml-1">uds</span>
                                                                    </div>

                                                                    <div className="grid grid-cols-2 gap-2 mt-2">
                                                                        <div className="text-center">
                                                                            <div className="text-[8px] font-black text-orange-500 uppercase mb-1">Prod.</div>
                                                                            {productionPhoto ? (
                                                                                <img
                                                                                    src={productionPhoto}
                                                                                    alt={`Producción carrito ${carrito.carritoNum || idx + 1}`}
                                                                                    className="w-full h-12 rounded-lg object-cover border-2 border-orange-200 cursor-pointer"
                                                                                    onClick={(e) => { e.stopPropagation(); setPhotoModal({ url: productionPhoto, label: `Foto producción · Carrito #${carrito.carritoNum || idx + 1}` }); }}
                                                                                />
                                                                            ) : (
                                                                                <div className="h-12 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300 text-xs">—</div>
                                                                            )}
                                                                        </div>
                                                                        <div className="text-center">
                                                                            <div className="text-[8px] font-black text-teal-600 uppercase mb-1">Recep.</div>
                                                                            {receptionPhoto ? (
                                                                                <img
                                                                                    src={receptionPhoto}
                                                                                    alt={`Recepción carrito ${carrito.carritoNum || idx + 1}`}
                                                                                    className="w-full h-12 rounded-lg object-cover border-2 border-teal-300 cursor-pointer"
                                                                                    onClick={(e) => { e.stopPropagation(); setPhotoModal({ url: receptionPhoto, label: `Foto recepción · Carrito #${carrito.carritoNum || idx + 1}` }); }}
                                                                                />
                                                                            ) : carrito.receivedAt ? (
                                                                                <div className="h-12 rounded-lg border-2 border-teal-300 bg-teal-50 flex items-center justify-center text-teal-600 font-black text-xs">OK</div>
                                                                            ) : (
                                                                                <div className="h-12 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 flex items-center justify-center text-amber-500 font-black text-[9px]">Pndte</div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <div className="bg-emerald-500 rounded-2xl p-5 text-center shadow-lg">
                                <div className="text-xs font-bold text-emerald-100 uppercase tracking-widest mb-2">🏷️ LOTE PARA ROTULAR EN TARROS</div>
                                <div className="text-3xl font-black text-white tracking-wider">{noteData.productionBatch?.batchNumber}</div>
                                <div className="text-xs text-emerald-100 mt-2 font-semibold">Escribe este lote en cada tarro antes de empacar</div>
                            </div>

                            {(() => {
                                // Pre-compute conteo & photo data once
                                const conteoNote = allBatchNotes.find(n => ['CONTEO', 'G_CONTEO'].includes(n.processType?.code));
                                const parsedConteoParams = typeof conteoNote?.processParameters === 'string' ? JSON.parse(conteoNote.processParameters) : (conteoNote?.processParameters || {});
                                const conteoMap = parsedConteoParams.conteo || {};
                                const conteoDraftMap = parsedConteoParams.conteo_draft || {};
                                const carriotsData = typeof parsedConteoParams.carriots === 'string' ? JSON.parse(parsedConteoParams.carriots) : (parsedConteoParams.carriots || []);
                                // Search ALL empaque notes for reception_photos (may be stored on any one of them)
                                const recPhotos = empaqueNotes.reduce((acc, en) => {
                                    const params = typeof en.processParameters === 'string' ? JSON.parse(en.processParameters) : (en.processParameters || {});
                                    const rp = params.reception_photos;
                                    return rp ? { ...acc, ...rp } : acc;
                                }, savedReceptionPhotos || {});
                                const conteoPhotosMap = typeof parsedConteoParams.conteo_photos === 'string' ? JSON.parse(parsedConteoParams.conteo_photos) : (parsedConteoParams.conteo_photos || {});

                                return empaqueNotes.map(en => {
                                    const isCompleted = en.status === 'COMPLETED';
                                    const isExecuting = en.status === 'EXECUTING';
                                    const nums2 = (en.stageName || '').toLowerCase().match(/\d{3,}/g) || [];
                                    const target2 = outputTargets.find(t =>
                                        nums2.some(n => (t.product?.name || '').toLowerCase().includes(n))
                                    );
                                    // Conteo data for this presentation
                                    const empData2 = en.empaqueData || {};
                                    const empRef2 = en.processParameters?.empaqueRef || {};
                                    const ce = target2 ? Object.values(conteoMap).find(c => String(c.productId) === String(target2.productId)) : null;

                                    const productCarriots = carriotsData.filter(c => String(c.productId) === String(target2?.productId || en.productId || target2?.product?.id));
                                    const carriotsSum = productCarriots.length > 0 ? productCarriots.reduce((sum, c) => sum + Number(c.qty), 0) : null;

                                    const plannedConteo = ce?.planned
                                        ?? empRef2.planned_qty
                                        ?? empData2.planned_qty
                                        ?? (target2?.plannedUnits > 0 ? target2.plannedUnits : undefined)
                                        ?? null;

                                    const draftValue = (target2 && conteoDraftMap[target2.productId] !== undefined) ? parseInt(conteoDraftMap[target2.productId], 10) : null;
                                    const actualConteo = carriotsSum !== null ? carriotsSum : (draftValue !== null && !isNaN(draftValue) ? draftValue : (ce?.actual ?? empData2.conteo_qty ?? empRef2.conteo_qty));
                                    const diff = actualConteo != null && plannedConteo ? actualConteo - plannedConteo : null;
                                    const prodImg = target2 ? conteoPhotosMap[target2.productId] : null;
                                    const recImg = target2 ? recPhotos[target2.productId] : null;

                                    return (
                                        <div key={en.id}
                                            onClick={() => {
                                                if (isCompleted && !isAdmin) return;
                                                if (en.id === noteData.id) {
                                                    if (onSkipToEmpaque) onSkipToEmpaque();
                                                } else {
                                                    navigate(`${isGenialityRoute ? '/geniality' : ''}/assembly-execution/${en.id}?skipIntro=1`);
                                                    setTimeout(() => window.location.reload(), 100);
                                                }
                                            }}
                                            className={`w-full rounded-2xl border-2 overflow-hidden transition-all shadow-sm
                                                ${isCompleted
                                                    ? (isAdmin
                                                        ? 'bg-slate-50 border-amber-300 hover:border-amber-400 hover:bg-amber-50/30 cursor-pointer'
                                                        : 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed')
                                                    : isExecuting ? 'bg-blue-50 border-blue-400 hover:border-blue-500 cursor-pointer' :
                                                        'bg-white border-slate-200 hover:border-violet-400 hover:bg-violet-50 cursor-pointer'}`}>
                                            {/* Header row — Name + Status */}
                                            <div className="flex items-center justify-between p-4 pb-2">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${isCompleted ? 'bg-slate-100' : isExecuting ? 'bg-blue-100' : 'bg-violet-100'}`}>
                                                        {isCompleted ? '✅' : isExecuting ? '⚡' : '📦'}
                                                    </div>
                                                    <div>
                                                        <div className="font-black text-slate-800 text-sm">{en.stageName || en.product?.name}</div>
                                                        {isCompleted && isAdmin && (
                                                            <div className="text-xs text-amber-600 font-bold mt-0.5">
                                                                🔄 Re-editar (Admin)
                                                            </div>
                                                        )}
                                                        {!isCompleted && (
                                                            <div className="text-xs text-violet-600 font-bold mt-0.5">
                                                                {isExecuting ? '→ Continuar empaque' : '→ Ir a empacar'}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 ${isCompleted ? 'bg-slate-200 text-slate-600' : isExecuting ? 'bg-blue-200 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                                                    {isCompleted ? 'Completado' : isExecuting ? 'En Proceso' : 'Pendiente'}
                                                </span>
                                            </div>

                                            {/* Detail row — Prog / Real / Diff + Photos */}
                                            {(plannedConteo || actualConteo) && (
                                                <div className="flex items-center justify-between px-4 pb-3 pt-1">
                                                    <div className="flex gap-4">
                                                        <div className="text-center">
                                                            <div className="text-[9px] font-bold text-slate-400 uppercase">Programado</div>
                                                            <div className="text-base font-black text-slate-500">{plannedConteo?.toLocaleString('es-CO') ?? '—'}</div>
                                                        </div>
                                                        <div className="text-center">
                                                            <div className="text-[9px] font-bold text-purple-500 uppercase">Real Recibido</div>
                                                            {adminEditingProduct === (target2?.productId || en.id) && isAdmin ? (
                                                                <div className="flex flex-col items-center gap-1" onClick={e => e.stopPropagation()}>
                                                                    <input
                                                                        type="number"
                                                                        inputMode="numeric"
                                                                        min="0"
                                                                        autoFocus
                                                                        value={adminEditValue}
                                                                        onChange={(e) => setAdminEditValue(e.target.value)}
                                                                        onFocus={(e) => e.target.select()}
                                                            className="w-28 px-2 py-2 text-2xl font-black text-red-700 bg-white border-3 border-red-400 rounded-xl text-center focus:border-red-500 outline-none"
                                                                    />
                                                                    <div className="flex gap-1.5">
                                                                        <button
                                                                            disabled={adminSaving}
                                                                            onClick={async (e) => {
                                                                                e.stopPropagation();
                                                                                const newVal = parseInt(adminEditValue, 10);
                                                                                if (isNaN(newVal) || newVal < 0) return;
                                                                                setAdminSaving(true);
                                                                                try {
                                                                                    const cNote = allBatchNotes.find(n => ['CONTEO', 'G_CONTEO'].includes(n.processType?.code));
                                                                                    if (cNote) {
                                                                                        const currentConteo = { ...cNote.processParameters?.conteo };
                                                                                        const matchKey = Object.keys(currentConteo).find(k => currentConteo[k].productId === target2?.productId);
                                                                                        if (matchKey) {
                                                                                            currentConteo[matchKey] = { ...currentConteo[matchKey], actual: newVal };
                                                                                            const token = localStorage.getItem('token');
                                                                                            await fetch(`/api/assembly-notes/${cNote.id}/process-params`, {
                                                                                                method: 'PATCH',
                                                                                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                                                                                body: JSON.stringify({ processParameters: { conteo: currentConteo, admin_conteo_edit: { productId: target2?.productId, oldValue: actualConteo, newValue: newVal, editedBy: user?.name || user?.email, editedAt: new Date().toISOString() } } })
                                                                                            });
                                                                                        }
                                                                                    }
                                                                                } catch (err) { console.error('Admin edit error:', err); }
                                                                                setAdminSaving(false);
                                                                                setAdminEditingProduct(null);
                                                                                setAdminEditValue('');
                                                                                window.location.reload();
                                                                            }}
                                                                            className="w-8 h-8 bg-green-500 hover:bg-green-600 active:scale-95 rounded-xl flex items-center justify-center shadow-md transition-all"
                                                                        >
                                                                            {adminSaving
                                                                                ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                                                : <span className="text-white text-sm font-bold">✓</span>
                                                                            }
                                                                        </button>
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); setAdminEditingProduct(null); setAdminEditValue(''); }}
                                                                            className="w-8 h-8 bg-slate-400 hover:bg-slate-500 active:scale-95 rounded-xl flex items-center justify-center shadow-md transition-all"
                                                                        >
                                                                            <span className="text-white text-sm font-bold">✕</span>
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="relative group">
                                                                    <div className={`text-base font-black ${diff === 0 ? 'text-green-600' : diff != null ? 'text-purple-600' : 'text-slate-400'}`}>
                                                                        {actualConteo?.toLocaleString('es-CO') ?? '—'}
                                                                    </div>
                                                                    {isAdmin && actualConteo != null && (
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); setAdminEditingProduct(target2?.productId || en.id); setAdminEditValue(String(actualConteo)); }}
                                                                            className="absolute -top-2 -right-3 w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-md transition-all opacity-70 hover:opacity-100"
                                                                            title="Editar Real Recibido (Solo Admin)"
                                                                        >
                                                                            <span className="text-white text-[8px] font-bold">✏️</span>
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                        {diff != null && diff !== 0 && (
                                                            <div className="text-center">
                                                                <div className="text-[9px] font-bold text-amber-500 uppercase">Diferencia</div>
                                                                <div className={`text-base font-black ${diff > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                                                                    {diff > 0 ? `+${diff}` : diff}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-1.5 shrink-0">
                                                        {prodImg && (
                                                            <img
                                                                src={prodImg}
                                                                alt="Prod"
                                                                className="w-10 h-10 rounded-lg object-cover border-2 border-orange-300 cursor-pointer shadow-sm"
                                                                onClick={(e) => { e.stopPropagation(); setPhotoModal({ url: prodImg, label: `📸 Foto Producción` }); }}
                                                            />
                                                        )}
                                                        {recImg && (
                                                            <img
                                                                src={recImg}
                                                                alt="Recep"
                                                                className="w-10 h-10 rounded-lg object-cover border-2 border-blue-400 cursor-pointer shadow-sm"
                                                                onClick={(e) => { e.stopPropagation(); setPhotoModal({ url: recImg, label: `📷 Foto Recepción` }); }}
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Detail section — Multiple Carritos if any */}
                                            {(() => {
                                                const productCarriots = summaryCarriots.filter(c => String(c.productId) === String(target2?.productId || en.productId));
                                                if (productCarriots.length === 0) return null;
                                                return (
                                                    <div className="mt-1 mx-4 mb-3 bg-white border border-slate-200 rounded-xl overflow-hidden">
                                                        <div className="bg-slate-50 flex items-center px-3 py-1.5 gap-2 border-b border-slate-200">
                                                            <span className="text-[12px]">🚚</span>
                                                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                                                Entregas de Producción ({productCarriots.length} {productCarriots.length === 1 ? 'carrito' : 'carritos'})
                                                            </span>
                                                        </div>
                                                        <div className="flex divide-x divide-slate-100 overflow-x-auto hide-scrollbar">
                                                            {productCarriots.map((c, idx) => (
                                                                <div key={idx} className="min-w-[130px] p-2 flex flex-col items-center">
                                                                    <div className="text-[10px] font-bold text-indigo-800 uppercase mb-0.5 whitespace-nowrap">Carrito #{c.carritoNum || idx + 1}</div>
                                                                    <div className="text-xl font-black text-slate-600 mb-2 leading-none mt-1">
                                                                        {c.qty} <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">uds</span>
                                                                    </div>
                                                                    <div className="flex gap-3">
                                                                        <div className="flex flex-col items-center gap-1.5">
                                                                            <span className="text-[8px] font-black text-orange-400 uppercase leading-none tracking-wider">Prod.</span>
                                                                            {getCarritoProductionPhoto(c) ? (
                                                                                <img 
                                                                                    src={getCarritoProductionPhoto(c)} 
                                                                                    alt="Envío" 
                                                                                    className="w-9 h-9 rounded-lg shrink-0 object-cover border-2 border-orange-200 cursor-pointer shadow-sm hover:border-orange-400 transition-all hover:scale-105" 
                                                                                    onClick={(e) => { e.stopPropagation(); setPhotoModal({ url: getCarritoProductionPhoto(c), label: `📸 Carrito #${c.carritoNum} - Envío Producción` }); }} 
                                                                                />
                                                                            ) : (
                                                                                <div className="w-9 h-9 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center shrink-0">
                                                                                    <span className="text-[12px] opacity-30">📷</span>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex flex-col items-center gap-1.5">
                                                                            <span className="text-[8px] font-black text-teal-500 uppercase leading-none tracking-wider">Recep.</span>
                                                                            {c.receivedAt && getCarritoReceptionPhoto(c) ? (
                                                                                <img 
                                                                                    src={getCarritoReceptionPhoto(c)} 
                                                                                    alt="Recepción" 
                                                                                    className="w-9 h-9 rounded-lg shrink-0 object-cover border-2 border-teal-400 cursor-pointer shadow-sm transition-all hover:scale-105" 
                                                                                    onClick={(e) => { e.stopPropagation(); setPhotoModal({ url: getCarritoReceptionPhoto(c), label: `✅ Carrito #${c.carritoNum} - Recepción Empaque` }); }} 
                                                                                />
                                                                            ) : c.receivedAt ? (
                                                                                <div className="w-9 h-9 rounded-lg border-2 border-teal-400 bg-teal-50 flex items-center justify-center shrink-0 shadow-sm" title="Recibido sin foto">
                                                                                    <span className="text-[14px]">✅</span>
                                                                                </div>
                                                                            ) : (
                                                                                <div className="w-9 h-9 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 flex items-center justify-center shrink-0 text-amber-500 font-bold text-[9px]">
                                                                                    Pndte
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    );
                                });
                            })()}
                        </div>

                        {/* Bottom guidance banner */}
                        <div className={`mx-6 mb-6 rounded-2xl p-4 text-center text-sm font-bold ${allDone
                            ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                            : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
                            {allDone
                                ? '✅ Todas las presentaciones completadas — presiona SIGUIENTE para avanzar'
                                : `⚠️ Debes completar TODAS las presentaciones (${empaqueNotes.length - completedCount} pendientes) antes de pasar al siguiente proceso`
                            }
                        </div>
                    </div>

                    {/* ── Photo Modal Overlay ── */}
                    {photoModal && (
                        <div
                            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
                            onClick={() => setPhotoModal(null)}
                        >
                            <div className="relative max-w-lg w-full" onClick={e => e.stopPropagation()}>
                                <div className="bg-white rounded-2xl overflow-hidden shadow-2xl">
                                    <div className="bg-slate-800 px-4 py-2 flex items-center justify-between">
                                        <span className="text-white font-bold text-sm truncate">{photoModal.label}</span>
                                        <button
                                            onClick={() => setPhotoModal(null)}
                                            className="w-8 h-8 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center transition-all"
                                        >
                                            <span className="text-white font-bold text-lg">✕</span>
                                        </button>
                                    </div>
                                    <img
                                        src={photoModal.url}
                                        alt={photoModal.label}
                                        className="w-full max-h-[70vh] object-contain bg-slate-100"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

    }

    // ── Target quantity value for display ────────────────────────────────────
    const pesajeTotalG = isPesaje && noteData.items?.length > 0
        ? noteData.items.reduce((sum, i) => sum + (i.plannedQuantity || 0), 0)
        : null;

    // ── Generic formula meta for other process types (Cocción, Enfriamiento, etc.) ──
    const formulaBaseQty = noteData.product?.formulas?.[0]?.baseQuantity || null;
    const formulaBaseUnit = noteData.product?.formulas?.[0]?.baseUnit || 'g';

    // For aggregate recipes, PESAJE.actualQuantity can be the lot count
    // (e.g. 2 lotes), so the displayed mass must come from the weighed items.
    const completedPesajes = isEnsamble
        ? allBatchNotes
            .filter(n => ['PESAJE', 'G_PESAJE'].includes(n.processType?.code) && n.status === 'COMPLETED' && (n.stageOrder || 0) < (noteData.stageOrder || 0))
            .sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0))
        : [];
    const ensambleMetaQty = completedPesajes.length > 0
        ? completedPesajes.reduce((sum, n) => sum + pesajeItemsTotalGrams(n), 0)
        : null;

    // ── For any step after PESAJE: show actual produced from completed PESAJE steps ──
    const isCoccion = noteData.processType?.code === 'COCCION';
    const isEnfriamiento = noteData.processType?.code === 'ENFRIAMIENTO';
    const isPostPesaje = !isPesaje && !isEnsamble && !isEmpaque && !isFormacion && !isConteo;
    // Use the LAST completed PESAJE actual (cumulative, includes everything)
    const postPesajeCompleted = isPostPesaje
        ? allBatchNotes
            .filter(n => ['PESAJE', 'G_PESAJE'].includes(n.processType?.code) && n.status === 'COMPLETED' && (n.stageOrder || 0) < (noteData.stageOrder || 0))
            .sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0))
        : [];
    const actualProducedTotal = postPesajeCompleted.length > 0
        ? postPesajeCompleted.reduce((sum, n) => sum + pesajeItemsTotalGrams(n), 0)
        : null;

    // ── CONTEO meta ──────────────────────────────────────────────────────────
    let conteoMeta = null;
    if (isConteo && outputTargets.length > 0) {
        const totalPlanned = outputTargets.reduce((sum, t) => sum + (t.plannedUnits || 0), 0);
        if (totalPlanned > 0) conteoMeta = totalPlanned;
    }

    const metaValue = isEnsamble && ensambleMeta
        ? `${Number(ensambleMeta).toLocaleString('es-CO')} ${ensambleMetaUnit}`
        : isConteo && conteoMeta
            ? `${conteoMeta.toLocaleString('es-CO')} uds`
            : isEmpaque
                ? `${empaqueConteo?.toLocaleString('es-CO') ?? empaquePlanned?.toLocaleString('es-CO') ?? '—'} tarros`
                : isFormacion && formacionMeta
                    ? `${Number(formacionMeta).toLocaleString('es-CO')} g`
                    : isPostPesaje && actualProducedTotal > 0
                        ? `${actualProducedTotal.toLocaleString('es-CO', { maximumFractionDigits: 1 })} g`
                        : pesajeTotalG
                            ? `${pesajeTotalG.toLocaleString('es-CO', { maximumFractionDigits: 1 })} g`
                            : formulaBaseQty
                                ? `${Number(formulaBaseQty).toLocaleString('es-CO')} ${formulaBaseUnit}`
                                : null;

    // Color theme based on process type
    const colors = isEnsamble
        ? { from: 'from-emerald-600', to: 'to-teal-500', border: 'border-emerald-400', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
        : isEmpaque
            ? { from: 'from-rose-500', to: 'to-pink-400', border: 'border-rose-400', badge: 'bg-rose-50 text-rose-700 border-rose-200' }
            : isConteo
                ? { from: 'from-cyan-600', to: 'to-sky-500', border: 'border-cyan-400', badge: 'bg-cyan-50 text-cyan-700 border-cyan-200' }
                : { from: 'from-blue-600', to: 'to-indigo-500', border: 'border-blue-400', badge: 'bg-blue-50 text-blue-700 border-blue-200' };

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-2 pb-24 px-3">
            {/* Step label */}
            <div className="flex items-center gap-2 mb-2">
                <div className={`h-7 w-7 rounded-full text-white flex items-center justify-center text-sm shadow bg-gradient-to-br ${colors.from} ${colors.to}`}>
                    {isAlreadyStarted ? '⚡' : '🚀'}
                </div>
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    {isAlreadyStarted ? 'Proceso en curso' : 'Inicio de proceso'}
                </div>
            </div>

            {/* Main card */}
            <div className={`bg-white rounded-2xl shadow-lg border-2 ${colors.border} overflow-hidden flex-1 flex flex-col animate-in slide-in-from-right-8 duration-300`}>
                {/* Header */}
                <div className={`bg-gradient-to-r ${colors.from} ${colors.to} py-2.5 px-4 text-center`}>
                    <span className="text-white font-extrabold text-sm uppercase tracking-widest leading-tight">
                        {noteData.stageName}
                    </span>
                    <span className="text-white/50 text-[10px] ml-2">· {noteData.processType?.name}</span>
                </div>

                <div className="flex-1 flex flex-col p-3 gap-3 overflow-auto min-h-0">
                    {/* ── Top row: Meta + Lote + Materiales ── */}
                    <div className="grid grid-cols-3 gap-2">
                        {/* Meta chip */}
                        {metaValue ? (
                            <div className={`rounded-xl p-2.5 text-center border ${colors.badge}`}>
                                <div className="text-[9px] font-bold uppercase mb-0.5 opacity-70">
                                    {isEnsamble ? 'Meta' : isEmpaque ? 'A Empacar' : isFormacion ? 'Meta (g)' : isPesaje ? 'Total (g)' : isPostPesaje ? 'Total Producido' : 'Total Lote'}
                                </div>
                                <div className="text-lg font-black leading-tight">{metaValue}</div>
                            </div>
                        ) : noteData.processParameters?.repeatTotal ? (
                            <div className="bg-indigo-50 rounded-xl p-2.5 text-center border border-indigo-200">
                                <div className="text-[9px] font-bold text-indigo-500 uppercase mb-0.5">Lotes a Fabricar</div>
                                <div className="text-lg font-black text-indigo-700">{noteData.processParameters.repeatTotal}</div>
                                <div className="text-[9px] text-indigo-400 font-semibold">
                                    Este es el #{noteData.processParameters.repeatBatch}
                                </div>
                            </div>
                        ) : (
                            <div className="bg-blue-50 rounded-xl p-2.5 text-center border border-blue-200">
                                <div className="text-[9px] font-bold text-blue-500 uppercase mb-0.5">Meta</div>
                                <input
                                    type="number"
                                    value={targetQuantityValue}
                                    onChange={(e) => onTargetQtyChange?.(e.target.value)}
                                    className="text-lg font-black text-blue-700 w-full text-center bg-transparent border-none outline-none"
                                    min="1"
                                />
                            </div>
                        )}

                        {/* Lote chip */}
                        <div className="bg-emerald-500 rounded-xl p-2.5 text-center shadow">
                            <div className="text-[9px] font-bold text-emerald-100 uppercase mb-0.5">🏷️ Lote</div>
                            <div className="text-[11px] font-black text-white break-all leading-tight">
                                {noteData.productionBatch?.batchNumber || '—'}
                            </div>
                        </div>

                        {/* Materiales chip */}
                        <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-200">
                            <div className="text-[9px] font-bold text-slate-500 uppercase mb-0.5">Materiales</div>
                            <div className="text-lg font-black text-slate-800">{noteData.items?.length || 0}</div>
                            <div className="text-[9px] text-slate-400">ingredientes</div>
                        </div>
                    </div>

                    {/* CONTEO: list presentations */}
                    {isConteo && outputTargets.length > 0 && (
                        <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200">
                            <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Presentaciones a Contar</div>
                            <div className="space-y-1.5">
                                {outputTargets.map((t, i) => (
                                    <div key={i} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
                                        <span className="text-xs font-semibold text-slate-700">{t.product?.name || t.product?.sku}</span>
                                        <span className="text-xs font-black text-cyan-600">{t.plannedUnits?.toLocaleString('es-CO')} uds</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* EMPAQUE: planificado vs conteo */}
                    {isEmpaque && (
                        <div className="grid grid-cols-2 gap-2">
                            <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-200">
                                <div className="text-[10px] font-bold text-slate-500 uppercase mb-0.5">Planificado</div>
                                <div className="text-xl font-black text-slate-700">{empaquePlanned?.toLocaleString('es-CO') ?? noteData.targetQuantity ?? '—'}</div>
                            </div>
                            <div className="bg-rose-50 rounded-xl p-2.5 text-center border border-rose-200">
                                <div className="text-[10px] font-bold text-rose-500 uppercase mb-0.5">Del Conteo</div>
                                <div className="text-xl font-black text-rose-700">{empaqueConteo?.toLocaleString('es-CO') ?? '—'}</div>
                            </div>
                        </div>
                    )}

                    {/* EMPAQUE: material availability validation */}
                    {isEmpaque && materialStatus !== null && materialStatus.length > 0 && (
                        <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-3">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-base">⚠️</span>
                                <span className="text-xs font-black text-red-700 uppercase">Materiales faltantes en zona de Producción</span>
                            </div>
                            <div className="space-y-1.5">
                                {materialStatus.map((m, i) => (
                                    <div key={i} className="flex justify-between items-center bg-white/80 px-2.5 py-1.5 rounded-lg border border-red-200">
                                        <span className="text-xs font-semibold text-red-800 truncate mr-2">{m.name}</span>
                                        <div className="text-right whitespace-nowrap">
                                            <span className="text-[10px] font-bold text-red-600">
                                                {m.required.toLocaleString('es-CO')} {m.unit}
                                            </span>
                                            <span className="text-[10px] text-red-400 ml-1">
                                                | {m.available.toLocaleString('es-CO')}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-2 text-[10px] text-red-600 font-bold text-center">
                                ⬆ Traslade estos materiales a producción antes de iniciar
                            </div>
                        </div>
                    )}
                    {isEmpaque && materialStatus !== null && materialStatus.length === 0 && (
                        <div className="bg-green-50 border border-green-200 rounded-xl p-2.5 text-center">
                            <span className="text-xs font-bold text-green-700">✅ Todos los materiales disponibles en producción</span>
                        </div>
                    )}

                    {/* ── Materials list — clean table layout ── */}
                    {noteData.items?.length > 0 && (
                        <div className="flex-1 min-h-0 flex flex-col">
                            <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 flex items-center gap-1.5">
                                <span>📋</span> Ingredientes a utilizar
                            </div>
                            <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-slate-50/50">
                                {/* Table header */}
                                <div className="grid grid-cols-[1fr_auto] sticky top-0 bg-slate-100 border-b border-slate-200 px-3 py-1.5">
                                    <span className="text-[9px] font-bold text-slate-500 uppercase">Material</span>
                                    <span className="text-[9px] font-bold text-slate-500 uppercase text-right">Cantidad</span>
                                </div>
                                {/* Table rows */}
                                <div className="divide-y divide-slate-100">
                                    {noteData.items.map((item, i) => (
                                        <div key={i} className="grid grid-cols-[1fr_auto] items-center px-3 py-2 hover:bg-white/80 transition-colors">
                                            <span className="text-xs font-semibold text-slate-700 leading-tight pr-3 break-words"
                                                style={{ wordBreak: 'break-word', hyphens: 'auto' }}>
                                                {item.component?.name || 'Material'}
                                            </span>
                                            <span className="text-xs font-black text-blue-600 whitespace-nowrap tabular-nums text-right bg-blue-50 px-2 py-0.5 rounded-md">
                                                {(item.plannedQuantity || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })} {item.unit}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Call to action */}
                    <div className="text-center pt-1 shrink-0">
                        <div className={`inline-block text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full ${isAlreadyStarted ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-700'}`}>
                            {isAlreadyStarted ? '⚡ Ya iniciado — Presiona SIGUIENTE' : '🚀 Presiona INICIAR PROCESO para consumir materiales'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default IntroStep;
