import React, { useState, useRef, useEffect } from 'react';
import { CheckCircle, Camera, AlertCircle, Timer, Lock, X } from 'lucide-react';
import api from '../../../services/api';

const GEBaseLiquidaStep = ({ note, onConfirm }) => {
    const [confirmed, setConfirmed] = useState(false);
    const [ingredientPhotos, setIngredientPhotos] = useState({});
    const [uploading, setUploading] = useState(null);
    const [timerActive, setTimerActive] = useState(false);
    const [timerDone, setTimerDone] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [waterConfirmed, setWaterConfirmed] = useState(false);
    const [modalPhoto, setModalPhoto] = useState(null);
    const intervalRef = useRef(null);
    const fileRefs = useRef({});

    const params = note?.processParameters || {};
    const timerMinutes = params.time_minutes || 20;
    const TIMER_SECONDS = timerMinutes * 60;
    const instruction = params.instruction || 'Agregue los ingredientes a la máquina según el orden indicado.';
    const specialInstructions = note?.specialInstructions || params.specialInstructions || '';
    const stageName = note?.stageName || 'Base Líquida';

    const baseItems = (note?.items || []).map((it, idx) => ({
        id: it.id || `item-${idx}`,
        name: it.component?.name || it.productName || 'Ingrediente',
        quantity: Math.round((it.plannedQuantity || 0) * 1000) / 1000,
        unit: it.unit || 'g',
    }));

    const waterIdx = 0;
    const waterPhotoTaken = !!ingredientPhotos[waterIdx];

    // Restore photos from processParameters on mount
    const restoredRef = useRef(false);
    useEffect(() => {
        if (restoredRef.current) return;
        restoredRef.current = true;
        const saved = params.ingredient_photos || {};
        if (Object.keys(saved).length > 0) {
            setIngredientPhotos(saved);
            if (saved[waterIdx]) setWaterConfirmed(true);
        }
        if (params.base_liquida_confirmed) {
            setConfirmed(true);
        }
        if (params.base_liquida_timer_done) {
            setTimerDone(true);
            setElapsed(TIMER_SECONDS);
        } else if (params.base_liquida_timer_started_at) {
            const startedAt = new Date(params.base_liquida_timer_started_at).getTime();
            const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
            if (elapsedSec >= TIMER_SECONDS) {
                setTimerDone(true);
                setElapsed(TIMER_SECONDS);
            } else {
                setElapsed(elapsedSec);
                setTimerActive(true);
            }
        }
    }, []);

    useEffect(() => {
        if (timerActive && !timerDone) {
            intervalRef.current = setInterval(() => {
                setElapsed(prev => {
                    if (prev >= TIMER_SECONDS) {
                        clearInterval(intervalRef.current);
                        setTimerDone(true);
                        setTimerActive(false);
                        saveTimerDone();
                        return TIMER_SECONDS;
                    }
                    return prev + 1;
                });
            }, 1000);
        }
        return () => clearInterval(intervalRef.current);
    }, [timerActive, timerDone]);

    const remaining = TIMER_SECONDS - elapsed;
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    const progress = (elapsed / TIMER_SECONDS) * 100;

    const saveTimerDone = async () => {
        if (!note?.id) return;
        try {
            const res = await api.get(`/assembly-notes/${note.id}`);
            const cur = res.data?.processParameters || {};
            await api.patch(`/assembly-notes/${note.id}`, {
                processParameters: { ...cur, base_liquida_timer_done: true }
            });
            onConfirm?.();
        } catch (e) { console.warn('save timer:', e.message); }
    };

    const handlePhoto = async (e, itemIdx) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(itemIdx);
        try {
            const form = new FormData();
            form.append('photo', file);
            form.append('noteId', note.id);
            form.append('context', `ingrediente_${itemIdx}`);
            const res = await api.post('/assembly-notes/upload-photo', form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const newPhotos = { ...ingredientPhotos, [itemIdx]: res.data.url };
            setIngredientPhotos(newPhotos);
            const extraParams = {};
            if (itemIdx === waterIdx && !waterConfirmed) {
                setWaterConfirmed(true);
                setTimerActive(true);
                extraParams.base_liquida_timer_active = true;
                extraParams.base_liquida_timer_started_at = new Date().toISOString();
            }
            try {
                const noteRes = await api.get(`/assembly-notes/${note.id}`);
                const cur = noteRes.data?.processParameters || {};
                await api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: { ...cur, ingredient_photos: newPhotos, ...extraParams }
                });
            } catch (e) { console.warn('save photos:', e.message); }
        } catch (err) {
            console.error('Error subiendo foto:', err);
        } finally {
            setUploading(null);
        }
    };

    const allPhotos = baseItems.length > 0 && baseItems.every((_, idx) => ingredientPhotos[idx]);
    const canConfirm = allPhotos;

    const handleConfirm = async () => {
        if (!canConfirm) return;
        setConfirmed(true);
        try {
            const res = await api.get(`/assembly-notes/${note.id}`);
            const cur = res.data?.processParameters || {};
            await api.patch(`/assembly-notes/${note.id}`, {
                processParameters: { ...cur, base_liquida_confirmed: true }
            });
        } catch (e) { console.warn('save confirm:', e.message); }
        setTimeout(() => onConfirm?.(), 400);
    };

    const formatQty = (qty) => {
        if (qty >= 1) return `${Math.round(qty).toLocaleString('es-CO')} g`;
        if (qty >= 0.01) return `${qty.toFixed(2)} g`;
        return `${qty.toFixed(3)} g`;
    };

    return (
        <div className="flex flex-col max-w-2xl mx-auto px-4 py-6 gap-5">
            <div className="bg-white rounded-2xl shadow-lg border-2 border-cyan-400 overflow-hidden">
                <div className="bg-gradient-to-r from-cyan-600 to-blue-500 p-3 text-center">
                    <span className="text-white font-extrabold text-sm uppercase tracking-widest">
                        💧 {stageName}
                    </span>
                </div>

                <div className="p-4 flex flex-col gap-4">
                    <div className="bg-cyan-50 border-2 border-cyan-200 rounded-xl p-3">
                        <div className="text-xs font-bold text-cyan-600 uppercase mb-1">Instrucción</div>
                        <div className="text-sm text-slate-700 leading-relaxed">{instruction}</div>
                    </div>

                    {specialInstructions && (
                        <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-3">
                            <div className="text-xs font-bold text-amber-600 uppercase mb-1">Orden de adición</div>
                            <div className="text-sm text-slate-700 leading-relaxed">{specialInstructions}</div>
                        </div>
                    )}

                    {/* Paso 1: Agua */}
                    {baseItems.length > 0 && (
                        <div>
                            <div className="text-xs font-bold text-blue-600 uppercase mb-2">
                                🚰 Paso 1 — Pesar agua e iniciar llenado
                            </div>
                            {(() => {
                                const item = baseItems[waterIdx];
                                const photo = ingredientPhotos[waterIdx];
                                return (
                                    <div className={`flex items-center gap-2 rounded-xl border-2 px-3 py-3 ${photo ? 'border-green-400 bg-green-50' : 'border-blue-400 bg-blue-50'}`}>
                                        <div className={`w-7 h-7 rounded-full font-black text-xs flex items-center justify-center flex-shrink-0 ${photo ? 'bg-green-200 text-green-700' : 'bg-blue-200 text-blue-700'}`}>
                                            {photo ? '✓' : '💧'}
                                        </div>
                                        <span className="text-sm font-bold text-slate-700 flex-1 min-w-0 truncate">{item.name}</span>
                                        <span className={`text-sm font-black flex-shrink-0 ${photo ? 'text-green-700' : 'text-blue-700'}`}>
                                            {formatQty(item.quantity)}
                                        </span>
                                        {photo ? (
                                            <img
                                                src={photo}
                                                alt="Agua"
                                                onClick={() => setModalPhoto(photo)}
                                                className="w-10 h-10 rounded-lg object-cover border-2 border-green-400 flex-shrink-0 cursor-pointer"
                                            />
                                        ) : (
                                            <button
                                                onClick={() => fileRefs.current[waterIdx]?.click()}
                                                disabled={uploading === waterIdx}
                                                className="w-9 h-9 rounded-lg bg-white border-2 border-dashed border-blue-400 flex items-center justify-center flex-shrink-0 active:scale-90 transition-all"
                                            >
                                                {uploading === waterIdx
                                                    ? <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                                    : <Camera size={18} className="text-blue-500" />
                                                }
                                            </button>
                                        )}
                                        <input
                                            ref={el => fileRefs.current[waterIdx] = el}
                                            type="file" accept="image/*" capture="environment"
                                            className="hidden"
                                            onChange={(e) => handlePhoto(e, waterIdx)}
                                        />
                                    </div>
                                );
                            })()}
                            {!waterPhotoTaken && (
                                <div className="mt-2 text-xs text-blue-500 font-semibold text-center">
                                    📸 Tome la foto del agua para desbloquear los demás ingredientes
                                </div>
                            )}
                        </div>
                    )}

                    {/* Timer — visible after water photo, BEFORE ingredients */}
                    {(waterPhotoTaken || timerActive || timerDone) && (
                        <div className="bg-slate-50 border-2 border-slate-200 rounded-xl p-4">
                            <div className="text-xs font-bold text-slate-500 uppercase mb-3 text-center">
                                ⏱️ Llenado del tanque ({timerMinutes} min)
                            </div>
                            <div className="flex flex-col items-center gap-3">
                                <div className="relative w-28 h-28">
                                    <svg className="w-28 h-28 -rotate-90" viewBox="0 0 112 112">
                                        <circle cx="56" cy="56" r="50" fill="none" stroke="#e2e8f0" strokeWidth="8" />
                                        <circle
                                            cx="56" cy="56" r="50" fill="none"
                                            stroke={timerDone ? '#22c55e' : '#0891b2'}
                                            strokeWidth="8" strokeLinecap="round"
                                            strokeDasharray={`${2 * Math.PI * 50}`}
                                            strokeDashoffset={`${2 * Math.PI * 50 * (1 - progress / 100)}`}
                                            style={{ transition: 'stroke-dashoffset 1s linear' }}
                                        />
                                    </svg>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        {timerDone ? (
                                            <CheckCircle size={36} className="text-green-500" />
                                        ) : (
                                            <>
                                                <span className="text-2xl font-black text-slate-700 leading-none">
                                                    {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
                                                </span>
                                                <span className="text-[10px] text-slate-400 font-semibold">restantes</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                {timerDone ? (
                                    <div className="text-green-600 font-black text-sm">✅ Llenado completo</div>
                                ) : (
                                    <>
                                        <div className="text-cyan-600 font-bold text-sm animate-pulse">🔄 Llenando tanque... pese los ingredientes mientras tanto</div>
                                        <button
                                            onClick={() => {
                                                clearInterval(intervalRef.current);
                                                setTimerDone(true);
                                                setTimerActive(false);
                                                setElapsed(TIMER_SECONDS);
                                                saveTimerDone();
                                            }}
                                            className="mt-1 px-4 py-2 rounded-lg bg-green-100 border border-green-300 text-green-700 font-bold text-xs uppercase active:scale-95 transition-all"
                                        >
                                            ✅ Ya se llenó el tanque
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Paso 2: Demás ingredientes */}
                    {baseItems.length > 1 && (
                        <div className={!waterPhotoTaken ? 'opacity-40 pointer-events-none' : ''}>
                            <div className="flex items-center gap-2 mb-2">
                                <div className="text-xs font-bold text-slate-500 uppercase">
                                    🧪 Paso 2 — Ingredientes ({baseItems.length - 1})
                                </div>
                                {!waterPhotoTaken && <Lock size={14} className="text-slate-400" />}
                            </div>
                            <div className="flex flex-col gap-1.5">
                                {baseItems.slice(1).map((item, i) => {
                                    const idx = i + 1;
                                    const photo = ingredientPhotos[idx];
                                    return (
                                        <div key={idx} className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 ${photo ? 'border-green-400 bg-green-50' : 'border-cyan-200 bg-cyan-50'}`}>
                                            <div className={`w-6 h-6 rounded-full font-black text-xs flex items-center justify-center flex-shrink-0 ${photo ? 'bg-green-200 text-green-700' : 'bg-cyan-100 text-cyan-700'}`}>
                                                {photo ? '✓' : idx + 1}
                                            </div>
                                            <span className="text-sm font-semibold text-slate-700 flex-1 min-w-0 truncate">{item.name}</span>
                                            <span className={`text-sm font-black flex-shrink-0 ${photo ? 'text-green-700' : 'text-cyan-700'}`}>
                                                {formatQty(item.quantity)}
                                            </span>
                                            {photo ? (
                                                <img
                                                    src={photo}
                                                    alt={item.name}
                                                    onClick={() => setModalPhoto(photo)}
                                                    className="w-10 h-10 rounded-lg object-cover border-2 border-green-400 flex-shrink-0 cursor-pointer"
                                                />
                                            ) : (
                                                <button
                                                    onClick={() => fileRefs.current[idx]?.click()}
                                                    disabled={uploading === idx}
                                                    className="w-9 h-9 rounded-lg bg-white border-2 border-dashed border-cyan-300 flex items-center justify-center flex-shrink-0 active:scale-90 transition-all"
                                                >
                                                    {uploading === idx
                                                        ? <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                                                        : <Camera size={18} className="text-cyan-500" />
                                                    }
                                                </button>
                                            )}
                                            <input
                                                ref={el => fileRefs.current[idx] = el}
                                                type="file" accept="image/*" capture="environment"
                                                className="hidden"
                                                onChange={(e) => handlePhoto(e, idx)}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Validación */}
                    {!canConfirm && (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                            <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                            <span className="text-xs text-red-600 font-semibold">
                                {!waterPhotoTaken
                                    ? 'Primero pese el agua y tome la foto para continuar'
                                    : !allPhotos
                                        ? `Faltan ${baseItems.length - Object.keys(ingredientPhotos).length} foto(s) de ingredientes`
                                        : 'Tome todas las fotos para confirmar ingredientes'
                                }
                            </span>
                        </div>
                    )}

                    {/* Confirmar */}
                    <button
                        onClick={handleConfirm}
                        disabled={!canConfirm || confirmed}
                        className={`w-full py-4 rounded-xl font-black text-base uppercase tracking-wider transition-all active:scale-95 shadow-lg
                            ${confirmed
                                ? 'bg-green-100 border-2 border-green-300 text-green-700'
                                : !canConfirm
                                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-cyan-600 to-blue-500 text-white hover:shadow-xl'
                            }`}
                    >
                        {confirmed
                            ? <span className="flex items-center justify-center gap-2"><CheckCircle size={20} /> Ingredientes Confirmados</span>
                            : '✅ Confirmar Ingredientes'
                        }
                    </button>
                </div>
            </div>
            <div className="h-24" />

            {modalPhoto && (
                <div
                    className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
                    onClick={() => setModalPhoto(null)}
                >
                    <button
                        onClick={() => setModalPhoto(null)}
                        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center"
                    >
                        <X size={24} className="text-white" />
                    </button>
                    <img
                        src={modalPhoto}
                        alt="Foto ingrediente"
                        className="max-w-full max-h-[85vh] rounded-xl shadow-2xl object-contain"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
};

export default GEBaseLiquidaStep;
