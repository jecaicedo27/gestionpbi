import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Camera } from 'lucide-react';
import api from '../../../services/api';

/**
 * MedicionStep — Quality measurement step for °Brix and pH.
 * Each measurement requires a value AND a mandatory photo of the instrument.
 */
const MedicionStep = ({ stepData, note, onMedicionChange }) => {
    const params = note?.processParameters || stepData?.processParameters || {};
    const measurements = params.measurements || [];
    const instruction = params.instruction || '';

    // ═══ PERSISTENCE: Restore from processParameters ═══
    const draft = params.medicion_draft || {};
    const [values, setValues] = useState(draft.values || {});
    const [photos, setPhotos] = useState(draft.photos || {});
    const [uploading, setUploading] = useState({});
    const fileInputRefs = useRef({});

    // ═══ PERSISTENCE: Save on blur / after photo upload ═══
    const stateRef = useRef({});
    stateRef.current = { values, photos };
    const saveDraft = useCallback(async () => {
        const noteId = note?.id || stepData?.id;
        if (!noteId) return;
        try {
            const s = stateRef.current;
            await api.patch(`/assembly-notes/${noteId}/process-params`, {
                processParameters: {
                    medicion_draft: { values: s.values, photos: s.photos }
                }
            });
        } catch (err) {
            console.warn('MedicionStep draft save failed:', err);
        }
    }, [note?.id, stepData?.id]);

    const updateValue = (key, val) => {
        setValues(prev => ({ ...prev, [key]: val }));
    };

    const handlePhotoCapture = useCallback(async (key, e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(prev => ({ ...prev, [key]: true }));
        try {
            const fd = new FormData();
            fd.append('photo', file);
            fd.append('noteId', note?.id || '');
            fd.append('context', `medicion_${key}`);
            const res = await api.post('/assembly-notes/upload-photo', fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setPhotos(prev => ({ ...prev, [key]: res.data.url || URL.createObjectURL(file) }));
        } catch (err) {
            setPhotos(prev => ({ ...prev, [key]: URL.createObjectURL(file) }));
        } finally {
            setUploading(prev => ({ ...prev, [key]: false }));
        }
        setTimeout(saveDraft, 500);
    }, [note?.id, saveDraft]);

    // Notify parent
    useEffect(() => {
        const allFilled = measurements.every(m => values[m.key] && parseFloat(values[m.key]) > 0);
        const allPhotos = measurements.every(m => !!photos[m.key]);
        const allInRange = measurements.every(m => {
            const v = parseFloat(values[m.key]);
            return v >= m.min && v <= m.max;
        });
        onMedicionChange?.({
            values,
            photos,
            isComplete: allFilled && allPhotos,
            allInRange
        });
    }, [values, photos]);

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-8 pb-36 px-4">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-full text-white flex items-center justify-center text-2xl shadow-md bg-gradient-to-br from-violet-500 to-purple-400">
                    🧪
                </div>
                <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                    MEDICIÓN DE PARÁMETROS
                </div>
            </div>

            {/* Card */}
            <div className="bg-white rounded-3xl shadow-2xl border-4 border-violet-400 overflow-hidden flex-1 flex flex-col">
                <div className="bg-gradient-to-r from-violet-600 to-purple-500 p-4 text-center">
                    <span className="text-white font-extrabold text-lg uppercase tracking-widest">
                        🧪 {note?.stageName || 'Medición de Parámetros'}
                    </span>
                    <div className="text-white/70 text-xs mt-0.5">Registra los valores de calidad de la mezcla</div>
                </div>

                <div className="flex-1 flex flex-col p-6 gap-5 overflow-auto">
                    {instruction && (
                        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 text-sm text-violet-800 font-medium">
                            📋 {instruction}
                        </div>
                    )}

                    {/* Measurements */}
                    {measurements.map((m) => {
                        const val = parseFloat(values[m.key]);
                        const hasValue = values[m.key] && !isNaN(val);
                        const inRange = hasValue && val >= m.min && val <= m.max;
                        const hasPhoto = !!photos[m.key];
                        const isUploading = !!uploading[m.key];

                        return (
                            <div key={m.key} className={`rounded-2xl p-5 border-2 transition-all ${hasValue && hasPhoto ? (inRange ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50') : 'border-slate-200 bg-slate-50'}`}>
                                <div className="flex justify-between items-center mb-3">
                                    <div className="text-sm font-bold text-slate-700 uppercase">{m.label}</div>
                                    <div className="text-xs text-slate-400 font-medium">Rango: {m.min} — {m.max} {m.unit}</div>
                                </div>

                                {/* Value input */}
                                <div className="flex items-center gap-4 mb-3">
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={values[m.key] || ''}
                                        onChange={e => updateValue(m.key, e.target.value)}
                                        onBlur={saveDraft}
                                        placeholder={`Ej: ${((m.min + m.max) / 2).toFixed(1)}`}
                                        className={`text-4xl font-black w-full text-center bg-white border-2 rounded-xl p-3 outline-none transition-all ${hasValue ? (inRange ? 'border-green-400 text-green-700' : 'border-red-400 text-red-600') : 'border-slate-200 text-slate-400'}`}
                                    />
                                    {m.unit && <span className="text-xl font-bold text-slate-500">{m.unit}</span>}
                                </div>

                                {hasValue && (
                                    <div className={`flex items-center gap-2 mb-3 text-sm font-bold ${inRange ? 'text-green-700' : 'text-red-700'}`}>
                                        {inRange ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                                        {inRange ? '✅ Dentro del rango aceptable' : `⚠️ Fuera de rango (${m.min} — ${m.max})`}
                                    </div>
                                )}

                                {/* Photo — mandatory */}
                                <div className={`rounded-xl p-3 border-2 border-dashed ${hasPhoto ? 'border-green-400 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
                                    <div className="text-xs font-bold text-slate-500 uppercase mb-2">
                                        📸 Foto del instrumento (OBLIGATORIA)
                                    </div>
                                    {hasPhoto ? (
                                        <div className="flex items-center gap-3">
                                            <img src={photos[m.key]} alt={m.label} className="w-20 h-20 rounded-lg object-cover border-2 border-green-400" />
                                            <div className="flex-1">
                                                <div className="text-green-700 font-bold text-sm">✅ Foto capturada</div>
                                                <button
                                                    onClick={() => fileInputRefs.current[m.key]?.click()}
                                                    className="text-xs text-blue-500 underline mt-1"
                                                >Cambiar foto</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => fileInputRefs.current[m.key]?.click()}
                                            disabled={isUploading}
                                            className="w-full flex items-center justify-center gap-2 py-3 bg-white border-2 border-slate-200 rounded-xl hover:border-violet-400 hover:bg-violet-50 transition-all font-bold text-slate-600"
                                        >
                                            <Camera size={20} />
                                            {isUploading ? 'Subiendo...' : `Tomar foto de ${m.label}`}
                                        </button>
                                    )}
                                    <input
                                        ref={el => fileInputRefs.current[m.key] = el}
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        className="hidden"
                                        onChange={e => handlePhotoCapture(m.key, e)}
                                    />
                                </div>
                            </div>
                        );
                    })}

                    {/* Summary */}
                    {measurements.every(m => values[m.key] && parseFloat(values[m.key]) > 0 && photos[m.key]) && (
                        <div className="text-center text-green-600 font-bold text-sm animate-pulse">
                            ✅ Todos los parámetros registrados con foto — presiona SIGUIENTE
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MedicionStep;
