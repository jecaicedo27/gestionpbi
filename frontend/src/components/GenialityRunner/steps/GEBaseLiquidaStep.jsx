import React, { useState, useRef, useEffect } from 'react';
import { CheckCircle, Camera, AlertCircle, Timer } from 'lucide-react';
import api from '../../../services/api';

/**
 * GEBaseLiquidaStep — Paso 2 Escarchado: Base Líquida + Incorporación
 *
 * El operador:
 *   1. Agrega 85,000g azúcar invertida de fructosa + 7,800g agua a la máquina
 *   2. Enciende agitación y recirculación
 *   3. Incorpora gradualmente el premix seco
 *   4. Mantiene condiciones durante 20 minutos
 *
 * Incluye un temporizador de 20 minutos y foto de evidencia obligatoria.
 */
const GEBaseLiquidaStep = ({ note, onConfirm }) => {
    const [confirmed, setConfirmed] = useState(false);
    const [photoUrl, setPhotoUrl] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [timerActive, setTimerActive] = useState(false);
    const [timerDone, setTimerDone] = useState(false);
    const [elapsed, setElapsed] = useState(0); // seconds
    const intervalRef = useRef(null);
    const fileRef = useRef(null);

    const TIMER_SECONDS = 20 * 60; // 20 min

    const baseItems = [
        { name: 'Azúcar Invertida de Fructosa', quantity: 85000, unit: 'g', color: 'blue' },
        { name: 'Agua', quantity: 7800, unit: 'g', color: 'blue' },
    ];

    // Timer logic
    useEffect(() => {
        if (timerActive && !timerDone) {
            intervalRef.current = setInterval(() => {
                setElapsed(prev => {
                    if (prev >= TIMER_SECONDS) {
                        clearInterval(intervalRef.current);
                        setTimerDone(true);
                        setTimerActive(false);
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

    const handleStartTimer = () => {
        if (!timerActive && !timerDone) setTimerActive(true);
    };

    const handlePhoto = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const form = new FormData();
            form.append('photo', file);
            form.append('noteId', note.id);
            form.append('context', 'base_liquida_incorporacion');
            const res = await api.post('/assembly-notes/upload-photo', form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setPhotoUrl(res.data.url);
        } catch (err) {
            console.error('Error subiendo foto base líquida:', err);
        } finally {
            setUploading(false);
        }
    };

    const canConfirm = photoUrl && timerDone;

    const handleConfirm = () => {
        if (!canConfirm) return;
        setConfirmed(true);
        setTimeout(() => onConfirm?.(), 400);
    };

    return (
        <div className="flex flex-col max-w-2xl mx-auto px-4 py-6 gap-5">
            <div className="bg-white rounded-2xl shadow-lg border-2 border-cyan-400 overflow-hidden">
                <div className="bg-gradient-to-r from-cyan-600 to-blue-500 p-3 text-center">
                    <span className="text-white font-extrabold text-sm uppercase tracking-widest">
                        💧 BASE LÍQUIDA + INCORPORACIÓN
                    </span>
                </div>

                <div className="p-4 flex flex-col gap-4">
                    {/* Instrucción */}
                    <div className="bg-cyan-50 border-2 border-cyan-200 rounded-xl p-3">
                        <div className="text-xs font-bold text-cyan-600 uppercase mb-1">Instrucción</div>
                        <div className="text-sm text-slate-700 leading-relaxed">
                            Agregue los ingredientes líquidos a la máquina. Encienda la <strong>agitación y recirculación</strong>,
                            luego incorpore gradualmente el premix seco. Mantenga durante <strong>20 minutos</strong>.
                        </div>
                    </div>

                    {/* Ingredientes líquidos */}
                    <div>
                        <div className="text-xs font-bold text-slate-500 uppercase mb-2">Ingredientes Base Líquida</div>
                        <div className="flex flex-col gap-2">
                            {baseItems.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between bg-cyan-50 border border-cyan-200 rounded-xl px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-7 h-7 rounded-full bg-cyan-100 text-cyan-700 font-black text-xs flex items-center justify-center">
                                            {idx + 1}
                                        </div>
                                        <span className="text-sm font-semibold text-slate-700">{item.name}</span>
                                    </div>
                                    <div className="text-sm font-black text-cyan-700">
                                        {item.quantity.toLocaleString('es-CO')} {item.unit}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Timer 20 minutos */}
                    <div className="bg-slate-50 border-2 border-slate-200 rounded-xl p-4">
                        <div className="text-xs font-bold text-slate-500 uppercase mb-3 text-center">
                            ⏱️ Temporizador de Incorporación
                        </div>

                        {/* Progress ring */}
                        <div className="flex flex-col items-center gap-3">
                            <div className="relative w-28 h-28">
                                <svg className="w-28 h-28 -rotate-90" viewBox="0 0 112 112">
                                    <circle cx="56" cy="56" r="50" fill="none" stroke="#e2e8f0" strokeWidth="8" />
                                    <circle
                                        cx="56" cy="56" r="50"
                                        fill="none"
                                        stroke={timerDone ? '#22c55e' : '#0891b2'}
                                        strokeWidth="8"
                                        strokeLinecap="round"
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
                                <div className="text-green-600 font-black text-sm">✅ Incorporación completa</div>
                            ) : timerActive ? (
                                <div className="text-cyan-600 font-bold text-sm animate-pulse">🔄 Incorporando con agitación...</div>
                            ) : (
                                <button
                                    onClick={handleStartTimer}
                                    className="px-6 py-2 bg-gradient-to-r from-cyan-600 to-blue-500 text-white rounded-xl font-black text-sm shadow-md active:scale-95 transition-all"
                                >
                                    <Timer size={16} className="inline mr-2" />
                                    Iniciar Incorporación (20 min)
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Foto */}
                    <div>
                        <div className="text-xs font-bold text-slate-500 uppercase mb-2">Foto de Evidencia</div>
                        {photoUrl ? (
                            <div className="relative rounded-xl overflow-hidden border-2 border-green-400">
                                <img src={photoUrl} alt="Base líquida" className="w-full h-40 object-cover" />
                                <div className="absolute top-2 right-2 bg-green-500 text-white text-xs font-bold rounded-full px-2 py-1 flex items-center gap-1">
                                    <CheckCircle size={12} /> OK
                                </div>
                                <button onClick={() => setPhotoUrl(null)} className="absolute bottom-2 right-2 bg-white/90 text-slate-600 text-xs font-bold rounded-full px-2 py-1 border border-slate-300">
                                    Cambiar
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => fileRef.current?.click()}
                                disabled={uploading}
                                className="w-full h-28 border-2 border-dashed border-cyan-300 rounded-xl flex flex-col items-center justify-center gap-2 text-cyan-600 bg-cyan-50 active:scale-95 transition-all"
                            >
                                {uploading ? <div className="text-sm font-bold animate-pulse">Subiendo...</div> : (
                                    <>
                                        <Camera size={28} />
                                        <span className="text-sm font-bold">Tomar foto de incorporación</span>
                                        <span className="text-xs text-cyan-500">Obligatorio para continuar</span>
                                    </>
                                )}
                            </button>
                        )}
                        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
                    </div>

                    {/* Validación */}
                    {!canConfirm && (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                            <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                            <span className="text-xs text-red-600 font-semibold">
                                {!timerDone ? 'Espera a que termine el temporizador de 20 min' : 'Falta la foto de evidencia'}
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
                            ? <span className="flex items-center justify-center gap-2"><CheckCircle size={20} /> ¡Incorporación Lista!</span>
                            : '✅ Confirmar Incorporación'
                        }
                    </button>
                </div>
            </div>
        </div>
    );
};

export default GEBaseLiquidaStep;
