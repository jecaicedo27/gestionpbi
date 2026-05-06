import React, { useState, useRef, useMemo, useEffect } from 'react';
import { CheckCircle, Camera, Thermometer, Package } from 'lucide-react';
import api from '../../../services/api';

// Compact "advance pesaje" sub-panel: shows the next PENDING note's items so
// the operator can pre-weigh them in the carrito while the marmita heats up
// or cools down. Saves directly to the next note's items via PATCH.
const AdvancePesajePanel = ({ nextNote, noteId }) => {
    const [actuals, setActuals] = useState({});
    const [photos, setPhotos] = useState({});
    const [lotNumbers, setLotNumbers] = useState({});  // { itemId: lotNumber }
    const [availableLotsMap, setAvailableLotsMap] = useState({});  // { itemId: [lots] }
    const [savingId, setSavingId] = useState(null);
    const fileRefs = useRef({});

    useEffect(() => {
        if (!nextNote?.items) return;
        const a = {}, l = {};
        for (const it of nextNote.items) {
            if (it.actualQuantity != null) a[it.id] = String(it.actualQuantity);
            if (it.lotNumber) l[it.id] = it.lotNumber;
        }
        // Photos viven en processParameters.weighing_photos (igual que PesajeBatchStep)
        const savedPhotos = nextNote?.processParameters?.weighing_photos || {};
        setActuals(a);
        setLotNumbers(l);
        setPhotos(savedPhotos);
    }, [nextNote?.id]);

    const items = useMemo(() => (nextNote?.items || []).slice().sort(
        (a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999)
    ), [nextNote]);

    // Fetch available lots per item
    useEffect(() => {
        items.forEach(it => {
            const compId = it.componentId || it.component?.id;
            if (!compId || availableLotsMap[it.id]) return;
            const nameU = (it.component?.name || '').toUpperCase();
            if (nameU.includes('AGUA')) return; // AGUA no necesita selector
            fetch(`/api/inventory/lots?productId=${compId}&status=AVAILABLE,LOW_STOCK&zone=PRODUCTION`, {
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
                        setAvailableLotsMap(prev => ({ ...prev, [it.id]: sorted }));
                    }
                })
                .catch(() => {});
        });
    }, [items]);

    const saveLot = async (itemId, lotNumber) => {
        setLotNumbers(prev => ({ ...prev, [itemId]: lotNumber }));
        try {
            await api.patch(`/assembly-notes/${nextNote.id}/items/${itemId}`, { lotNumber });
        } catch (e) { console.warn('save lot:', e.message); }
    };

    const saveQty = async (itemId, value) => {
        setActuals(prev => ({ ...prev, [itemId]: value }));
        const num = parseFloat(value);
        if (isNaN(num) || num <= 0) return;
        try {
            await api.patch(`/assembly-notes/${nextNote.id}/items/${itemId}`, { actualQuantity: num });
        } catch (e) { console.warn('save advance qty:', e.message); }
    };

    const savePhoto = async (e, itemId) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setSavingId(itemId);
        try {
            const form = new FormData();
            form.append('photo', file);
            form.append('noteId', nextNote.id);
            form.append('context', `advance_pesaje_${itemId}`);
            const res = await api.post('/assembly-notes/upload-photo', form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const newPhotos = { ...photos, [itemId]: res.data.url };
            setPhotos(newPhotos);
            // Persist into nextNote.processParameters.weighing_photos so PesajeBatchStep
            // de la nota siguiente la encuentra al renderizarse.
            try {
                const cur = (await api.get(`/assembly-notes/${nextNote.id}`)).data?.processParameters || {};
                await api.patch(`/assembly-notes/${nextNote.id}`, {
                    processParameters: { ...cur, weighing_photos: newPhotos }
                });
            } catch (e) { console.warn('save photos:', e.message); }
        } catch (err) { console.error('foto adelanto:', err); }
        finally { setSavingId(null); }
    };

    if (!nextNote || !items.length) return null;

    const completed = items.filter(it => {
        const isAgua = (it.component?.name || '').toUpperCase().includes('AGUA');
        return actuals[it.id] && photos[it.id] && (isAgua || lotNumbers[it.id]);
    }).length;

    return (
        <div className="bg-white rounded-xl border-2 border-blue-300 overflow-hidden shadow-md">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-500 px-5 py-3 flex items-center gap-2">
                <Package className="w-5 h-5 text-white" />
                <h2 className="text-white font-black text-base flex-1">⏳ Mientras esperas — adelanta el pesaje</h2>
                <span className="text-white/90 text-xs font-bold">{completed}/{items.length}</span>
            </div>
            <div className="p-3 bg-blue-50 border-b border-blue-200">
                <div className="text-[11px] text-blue-900 font-bold uppercase tracking-wide">Próximo: {nextNote.stageName}</div>
                <div className="text-xs text-blue-700">Pesa estos ingredientes en el carrito ahora. Cuando llegues al siguiente paso, ya estarán listos.</div>
            </div>
            <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {items.map((it, idx) => {
                    const planned = it.plannedQuantity || 0;
                    const filled = actuals[it.id] && parseFloat(actuals[it.id]) > 0;
                    const hasPhoto = !!photos[it.id];
                    const isAgua = (it.component?.name || '').toUpperCase().includes('AGUA');
                    const hasLot = isAgua || !!lotNumbers[it.id];
                    const done = filled && hasPhoto && hasLot;
                    const lots = availableLotsMap[it.id] || [];
                    return (
                        <div key={it.id} className={`rounded-lg border-2 p-2 ${done ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white'}`}>
                            <div className="flex items-center justify-between gap-2 mb-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${done ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-700'}`}>
                                        {done ? '✓' : idx + 1}
                                    </span>
                                    <span className="font-bold text-xs truncate">{it.component?.name || 'Ingrediente'}</span>
                                </div>
                                <span className="text-[10px] text-gray-500 font-bold whitespace-nowrap">{Math.round(planned).toLocaleString()} g</span>
                            </div>
                            <div className="flex gap-1.5 mb-1">
                                <input
                                    type="number"
                                    placeholder={`${Math.round(planned)}`}
                                    value={actuals[it.id] || ''}
                                    onChange={(e) => saveQty(it.id, e.target.value)}
                                    className="flex-1 min-w-0 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-400"
                                />
                                <input
                                    ref={(el) => fileRefs.current[it.id] = el}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    onChange={(e) => savePhoto(e, it.id)}
                                />
                                {hasPhoto ? (
                                    <button onClick={() => fileRefs.current[it.id]?.click()} className="px-2 py-1 bg-green-100 text-green-700 rounded text-[10px] font-bold flex items-center gap-1">
                                        ✓ <Camera className="w-3 h-3" />
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => fileRefs.current[it.id]?.click()}
                                        disabled={savingId === it.id}
                                        className="px-2 py-1 bg-blue-500 text-white rounded text-[10px] font-bold flex items-center gap-1 disabled:opacity-50"
                                    >
                                        <Camera className="w-3 h-3" /> {savingId === it.id ? '…' : 'Foto'}
                                    </button>
                                )}
                            </div>
                            {!isAgua && (
                                <select
                                    value={lotNumbers[it.id] || ''}
                                    onChange={(e) => saveLot(it.id, e.target.value)}
                                    className={`w-full text-[10px] py-1 px-2 rounded border ${hasLot ? 'border-green-300 bg-green-50' : 'border-gray-300 bg-white'} focus:ring-1 focus:ring-blue-400`}
                                >
                                    <option value="">— Seleccionar lote —</option>
                                    {lots.map(l => (
                                        <option key={l.id} value={l.lotNumber}>
                                            {l.lotNumber} ({Math.round(l.currentQuantity).toLocaleString()} g)
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const CHECKPOINTS = [
    {
        id: 'inv_temp_90',
        temp: 90,
        color: 'red',
        title: 'Calentamiento — 90°C',
        instruction: 'Caliente la mezcla (agua + ácido cítrico + azúcar + fructosa) con agitación y recirculación constante hasta alcanzar 90°C, asegurando la disolución e inversión de los azúcares. Fotografíe el termómetro al alcanzar la temperatura.',
        context: 'inversion_calentamiento_90c',
    },
    {
        id: 'inv_temp_55',
        temp: 55,
        color: 'green',
        title: 'Enfriamiento — 55°C (listo para incorporación)',
        instruction: 'Apague el calentamiento y deje enfriar con agitación suave hasta descender a 55°C. Fotografíe el termómetro como evidencia.',
        context: 'inversion_enfriamiento_55c',
    },
];

const colorMap = {
    red: { header: 'from-red-600 to-orange-500', text: 'text-red-600', badge: 'bg-red-100 text-red-700', dash: 'border-red-300', btn: 'from-red-600 to-orange-500' },
    green: { header: 'from-green-600 to-teal-500', text: 'text-green-600', badge: 'bg-green-100 text-green-700', dash: 'border-green-300', btn: 'from-green-600 to-teal-500' },
};

const CoccionInversionStep = ({ note, onConfirm, allBatchNotes = [] }) => {
    // Restore prior state from processParameters
    const restoredRef = useRef(false);

    // Find next PENDING note of the same batch (typically GE_PREMIX after
    // GE_BASE_LIQUIDA) so the operator can pre-weigh while waiting for the
    // marmita to heat / cool.
    const nextNote = useMemo(() => {
        if (!note || !allBatchNotes.length) return null;
        const myOrder = note.stageOrder ?? 0;
        const candidates = allBatchNotes
            .filter(n => (n.stageOrder ?? 0) > myOrder && n.status === 'PENDING' && (n.items?.length || 0) > 0)
            .sort((a, b) => (a.stageOrder ?? 0) - (b.stageOrder ?? 0));
        return candidates[0] || null;
    }, [note, allBatchNotes]);

    const [activeCheckpoint, setActiveCheckpoint] = useState(0);
    const [photos, setPhotos] = useState({});
    const [uploading, setUploading] = useState(false);
    const [completed, setCompleted] = useState(false);
    const fileRef = useRef(null);

    const cp = CHECKPOINTS[activeCheckpoint];
    const c = colorMap[cp.color];
    const allDone = CHECKPOINTS.every(p => photos[p.id]);

    // Restore photos from processParameters on mount
    useEffect(() => {
        if (restoredRef.current) return;
        restoredRef.current = true;
        const saved = note?.processParameters?.coccion_inversion_photos || {};
        if (Object.keys(saved).length > 0) {
            setPhotos(saved);
            const lastDone = CHECKPOINTS.findIndex(p => !saved[p.id]);
            setActiveCheckpoint(lastDone === -1 ? CHECKPOINTS.length - 1 : lastDone);
        }
        if (note?.processParameters?.coccion_inversion_completed) {
            setCompleted(true);
        }
    }, [note?.id]);

    const handlePhoto = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const form = new FormData();
            form.append('photo', file);
            form.append('noteId', note.id);
            form.append('context', cp.context);
            const res = await api.post('/assembly-notes/upload-photo', form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const newPhotos = { ...photos, [cp.id]: res.data.url };
            setPhotos(newPhotos);
            // Persist immediately to processParameters so the wizard can unlock
            // "Completar etapa" only when both checkpoints have photos.
            if (note?.id) {
                try {
                    const cur = (await api.get(`/assembly-notes/${note.id}`)).data?.processParameters || {};
                    await api.patch(`/assembly-notes/${note.id}`, {
                        processParameters: { ...cur, coccion_inversion_photos: newPhotos }
                    });
                } catch (e) { console.warn('persist coccion photo:', e.message); }
            }
        } catch (err) {
            console.error('Error subiendo foto inversión:', err);
        } finally {
            setUploading(false);
        }
    };

    const handleAdvance = () => {
        if (!photos[cp.id]) return;
        if (activeCheckpoint < CHECKPOINTS.length - 1) {
            setActiveCheckpoint(i => i + 1);
        }
    };

    const handleConfirm = async () => {
        if (!allDone) return;
        setCompleted(true);
        // Persist flag so the wizard knows this step is complete
        if (note?.id) {
            try {
                const cur = (await api.get(`/assembly-notes/${note.id}`)).data?.processParameters || {};
                await api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: {
                        ...cur,
                        coccion_inversion_completed: true,
                        coccion_inversion_photos: photos,
                    }
                });
            } catch (e) { console.warn('save coccion inversion:', e.message); }
        }
        setTimeout(() => onConfirm?.(), 400);
    };

    return (
        <div className="flex flex-col max-w-2xl mx-auto px-4 py-6 gap-5">
            <div className="flex items-center justify-between gap-2 px-2">
                {CHECKPOINTS.map((p, idx) => {
                    const done = !!photos[p.id];
                    const active = idx === activeCheckpoint;
                    return (
                        <React.Fragment key={p.id}>
                            <div className={`flex flex-col items-center gap-1 ${active ? 'scale-110' : ''}`}>
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm ${done ? 'bg-green-500 text-white' : active ? `bg-gradient-to-br ${colorMap[p.color].header} text-white` : 'bg-gray-200 text-gray-400'}`}>
                                    {done ? '✓' : `${p.temp}°`}
                                </div>
                                <span className={`text-[10px] font-bold ${active ? colorMap[p.color].text : 'text-gray-400'}`}>{p.temp}°C</span>
                            </div>
                            {idx < CHECKPOINTS.length - 1 && (
                                <div className={`flex-1 h-1 rounded ${photos[p.id] ? 'bg-green-400' : 'bg-gray-200'}`} />
                            )}
                        </React.Fragment>
                    );
                })}
            </div>

            <div className={`bg-white rounded-xl border-2 ${c.dash} overflow-hidden shadow-md`}>
                <div className={`bg-gradient-to-r ${c.header} px-5 py-3 flex items-center gap-2`}>
                    <Thermometer className="w-5 h-5 text-white" />
                    <h2 className="text-white font-black text-base flex-1">{cp.title}</h2>
                    <span className="text-white/90 text-xs font-bold">{activeCheckpoint + 1}/{CHECKPOINTS.length}</span>
                </div>
                <div className="p-5 space-y-4">
                    <p className="text-sm text-gray-700 leading-relaxed">{cp.instruction}</p>

                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={handlePhoto}
                    />

                    {photos[cp.id] ? (
                        <div className="space-y-3">
                            <img src={photos[cp.id]} alt="termómetro" className="w-full max-h-64 object-contain rounded-lg border-2 border-green-400" />
                            <div className="flex items-center gap-2 text-green-600 font-bold text-sm">
                                <CheckCircle className="w-5 h-5" />
                                <span>Foto registrada</span>
                            </div>
                            {activeCheckpoint < CHECKPOINTS.length - 1 ? (
                                <button
                                    onClick={handleAdvance}
                                    className={`w-full bg-gradient-to-r ${c.btn} text-white font-black py-3 rounded-lg shadow hover:scale-[1.02] transition`}
                                >
                                    Siguiente checkpoint →
                                </button>
                            ) : null}
                        </div>
                    ) : (
                        <button
                            onClick={() => fileRef.current?.click()}
                            disabled={uploading}
                            className={`w-full bg-gradient-to-r ${c.btn} text-white font-black py-4 rounded-lg shadow flex items-center justify-center gap-2 hover:scale-[1.02] transition disabled:opacity-50`}
                        >
                            <Camera className="w-5 h-5" />
                            {uploading ? 'Subiendo…' : `Foto del termómetro a ${cp.temp}°C`}
                        </button>
                    )}
                </div>
            </div>

            {nextNote && <AdvancePesajePanel nextNote={nextNote} noteId={note?.id} />}

            {allDone && (
                <button
                    onClick={handleConfirm}
                    disabled={completed}
                    className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white font-black py-4 rounded-xl shadow-lg hover:scale-[1.02] transition disabled:opacity-50"
                >
                    {completed ? '✓ Confirmado' : '✅ Confirmar cocción + enfriamiento'}
                </button>
            )}
        </div>
    );
};

export default CoccionInversionStep;
