import React, { useState, useRef } from 'react';
import { CheckCircle, Camera, AlertCircle, Thermometer } from 'lucide-react';
import api from '../../../services/api';

/**
 * GECoccionStep — Paso 3 Escarchado: Cocción y Enfriamiento
 *
 * 3 puntos de control secuenciales con foto obligatoria:
 *   1. Temperatura 65°C (calentamiento)
 *   2. Temperatura 45°C → agregar 43g sorbato de potasio
 *   3. Temperatura 40°C → listo para empacar
 */

const CHECKPOINTS = [
    {
        id: 'temp_65',
        temp: 65,
        color: 'red',
        title: 'Calentamiento — 65°C',
        instruction: 'Caliente la mezcla hasta alcanzar 65°C. Photograph el display del termómetro al llegar a esta temperatura.',
        context: 'coccion_65c',
        accion: null,
    },
    {
        id: 'temp_45',
        temp: 45,
        color: 'orange',
        title: 'Primer Enfriamiento — 45°C + Sorbato',
        instruction: 'Enfríe hasta 45°C. Al llegar, agregue 43g de sorbato de potasio y asegure su completa disolución mediante agitación. Fotografíe el termómetro.',
        context: 'enfriamiento_45c_sorbato',
        accion: { label: '+ 43g Sorbato de Potasio', icon: '🧪' },
    },
    {
        id: 'temp_40',
        temp: 40,
        color: 'green',
        title: 'Enfriamiento Final — 40°C',
        instruction: 'Continúe el enfriamiento hasta 40°C. El sirope escarchado está listo para envasado. Fotografíe el termómetro como evidencia final.',
        context: 'enfriamiento_40c_listo',
        accion: null,
    },
];

const colorMap = {
    red: { bg: 'bg-red-50', border: 'border-red-400', header: 'from-red-600 to-orange-500', text: 'text-red-600', badge: 'bg-red-100 text-red-700', dash: 'border-red-300', btn: 'from-red-600 to-orange-500', ring: '#dc2626' },
    orange: { bg: 'bg-orange-50', border: 'border-orange-400', header: 'from-orange-600 to-amber-500', text: 'text-orange-600', badge: 'bg-orange-100 text-orange-700', dash: 'border-orange-300', btn: 'from-orange-600 to-amber-500', ring: '#ea580c' },
    green: { bg: 'bg-green-50', border: 'border-green-400', header: 'from-green-600 to-teal-500', text: 'text-green-600', badge: 'bg-green-100 text-green-700', dash: 'border-green-300', btn: 'from-green-600 to-teal-500', ring: '#16a34a' },
};

const GECoccionStep = ({ note, onConfirm }) => {
    const [activeCheckpoint, setActiveCheckpoint] = useState(0);
    const [photos, setPhotos] = useState({}); // { temp_65: url, temp_45: url, temp_40: url }
    const [uploading, setUploading] = useState(false);
    const [completed, setCompleted] = useState(false);
    const fileRef = useRef(null);
    const [uploadingFor, setUploadingFor] = useState(null);

    const cp = CHECKPOINTS[activeCheckpoint];
    const c = colorMap[cp.color];
    const allDone = CHECKPOINTS.every(p => photos[p.id]);

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
            setPhotos(prev => ({ ...prev, [cp.id]: res.data.url }));
        } catch (err) {
            console.error('Error subiendo foto cocción:', err);
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

    const handleConfirm = () => {
        if (!allDone) return;
        setCompleted(true);
        setTimeout(() => onConfirm?.(), 400);
    };

    return (
        <div className="flex flex-col max-w-2xl mx-auto px-4 py-6 gap-5">

            {/* Progress bar de checkpoints */}
            <div className="flex items-center justify-between gap-2 px-2">
                {CHECKPOINTS.map((p, idx) => {
                    const done = !!photos[p.id];
                    const active = idx === activeCheckpoint;
                    return (
                        <React.Fragment key={p.id}>
                            <div className="flex flex-col items-center gap-1">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-sm border-2 transition-all
                                    ${done ? 'bg-green-500 border-green-500 text-white' : active ? 'bg-white border-red-500 text-red-600' : 'bg-slate-100 border-slate-300 text-slate-400'}`}>
                                    {done ? <CheckCircle size={18} /> : `${p.temp}°`}
                                </div>
                                <span className="text-[9px] font-bold text-slate-400 text-center leading-tight">{p.temp}°C</span>
                            </div>
                            {idx < CHECKPOINTS.length - 1 && (
                                <div className={`flex-1 h-0.5 ${idx < activeCheckpoint ? 'bg-green-400' : 'bg-slate-200'}`} />
                            )}
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Checkpoint activo */}
            <div className={`bg-white rounded-2xl shadow-lg border-2 ${c.border} overflow-hidden`}>
                <div className={`bg-gradient-to-r ${c.header} p-3 text-center`}>
                    <span className="text-white font-extrabold text-sm uppercase tracking-widest">
                        🌡️ {cp.title}
                    </span>
                </div>

                <div className="p-4 flex flex-col gap-4">
                    {/* Temperatura target */}
                    <div className={`${c.bg} border-2 ${c.border} rounded-xl p-4 flex items-center justify-between`}>
                        <div className="flex items-center gap-3">
                            <Thermometer size={32} className={c.text} />
                            <div>
                                <div className="text-xs font-bold text-slate-400 uppercase">Temperatura objetivo</div>
                                <div className={`text-4xl font-black ${c.text}`}>{cp.temp}°C</div>
                            </div>
                        </div>
                        {cp.accion && (
                            <div className={`${c.badge} rounded-xl px-3 py-2 text-center font-black text-sm`}>
                                <div className="text-lg">{cp.accion.icon}</div>
                                <div className="text-xs">{cp.accion.label}</div>
                            </div>
                        )}
                    </div>

                    {/* Instrucción */}
                    <div className={`${c.bg} rounded-xl p-3 border ${c.border}`}>
                        <div className={`text-xs font-bold ${c.text} uppercase mb-1`}>Instrucción</div>
                        <div className="text-sm text-slate-700 leading-relaxed">{cp.instruction}</div>
                    </div>

                    {/* Foto */}
                    <div>
                        <div className="text-xs font-bold text-slate-500 uppercase mb-2">📸 Foto del Termómetro</div>
                        {photos[cp.id] ? (
                            <div className="relative rounded-xl overflow-hidden border-2 border-green-400">
                                <img src={photos[cp.id]} alt={`Temp ${cp.temp}°C`} className="w-full h-44 object-cover" />
                                <div className="absolute top-2 right-2 bg-green-500 text-white text-xs font-bold rounded-full px-2 py-1 flex items-center gap-1">
                                    <CheckCircle size={12} /> {cp.temp}°C ✓
                                </div>
                                <button onClick={() => setPhotos(p => ({ ...p, [cp.id]: null }))} className="absolute bottom-2 right-2 bg-white/90 text-slate-600 text-xs font-bold rounded-full px-2 py-1 border border-slate-300">
                                    Cambiar
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => fileRef.current?.click()}
                                disabled={uploading}
                                className={`w-full h-32 border-2 border-dashed ${c.dash} rounded-xl flex flex-col items-center justify-center gap-2 ${c.text} ${c.bg} active:scale-95 transition-all`}
                            >
                                {uploading ? <div className="text-sm font-bold animate-pulse">Subiendo...</div> : (
                                    <>
                                        <Camera size={28} />
                                        <span className="text-sm font-bold">Foto del termómetro a {cp.temp}°C</span>
                                        <span className={`text-xs opacity-70`}>Obligatorio para continuar</span>
                                    </>
                                )}
                            </button>
                        )}
                        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
                    </div>

                    {/* Alerta */}
                    {!photos[cp.id] && (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                            <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                            <span className="text-xs text-red-600 font-semibold">Fotografía el termómetro para continuar</span>
                        </div>
                    )}

                    {/* Botón de avance o confirmación final */}
                    {activeCheckpoint < CHECKPOINTS.length - 1 ? (
                        <button
                            onClick={handleAdvance}
                            disabled={!photos[cp.id]}
                            className={`w-full py-4 rounded-xl font-black text-base uppercase tracking-wider transition-all active:scale-95 shadow-lg
                                ${!photos[cp.id]
                                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                    : `bg-gradient-to-r ${c.btn} text-white hover:shadow-xl`
                                }`}
                        >
                            Continuar → {CHECKPOINTS[activeCheckpoint + 1].temp}°C
                        </button>
                    ) : (
                        <button
                            onClick={handleConfirm}
                            disabled={!allDone || completed}
                            className={`w-full py-4 rounded-xl font-black text-base uppercase tracking-wider transition-all active:scale-95 shadow-lg
                                ${completed
                                    ? 'bg-green-100 border-2 border-green-300 text-green-700'
                                    : !allDone
                                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-green-600 to-teal-500 text-white hover:shadow-xl'
                                }`}
                        >
                            {completed
                                ? <span className="flex items-center justify-center gap-2"><CheckCircle size={20} /> ¡Proceso Completado!</span>
                                : '✅ Listo para Empacar (40°C)'
                            }
                        </button>
                    )}
                </div>
            </div>

            {/* Resumen de checkpoints completados */}
            {Object.keys(photos).length > 0 && (
                <div className="bg-white rounded-xl shadow border border-slate-200 p-3">
                    <div className="text-xs font-bold text-slate-400 uppercase mb-2">Controles registrados</div>
                    <div className="flex gap-2">
                        {CHECKPOINTS.map(p => (
                            <div key={p.id} className={`flex-1 text-center rounded-lg py-2 text-xs font-black
                                ${photos[p.id] ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                                {photos[p.id] ? '✅' : '⏳'} {p.temp}°C
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default GECoccionStep;
