import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Thermometer, Camera, Timer, CheckCircle2, AlertCircle, Bell } from 'lucide-react';
import api from '../../../services/api';

/**
 * CoccionStep — Temperature control step with photo proof and countdown timer.
 * When timer finishes: alarm sound + vibration + modal until operator acknowledges.
 */
const CoccionStep = ({ stepData, note, onCoccionChange, allBatchNotes = [] }) => {
    const params = note?.processParameters || stepData?.processParameters || {};
    const targetTemp = params.targetTemperature || 105;
    const unit = params.temperatureUnit || '°C';
    const timerMin = params.timerMinutes || 0;
    const instruction = params.instruction || '';
    const photoRequired = params.photoRequired !== false;

    const [realTemperature, setRealTemperature] = useState('');
    const [photoUrl, setPhotoUrl] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [conservanteActuals, setConservanteActuals] = useState({});

    // Compute conservante items for validation
    const isConservanteStep = (note?.stageName || '').toLowerCase().includes('conservante');
    let conservanteItems = [];
    if (isConservanteStep) {
        conservanteItems = (note?.items || []).filter(i => i.plannedQuantity > 0);
        if (conservanteItems.length === 0 && allBatchNotes.length > 0) {
            const currentOrder = note?.stageOrder || 0;
            const nextPesaje = allBatchNotes
                .filter(n => (n.stageOrder || 0) > currentOrder && n.processType?.code === 'PESAJE')
                .sort((a, b) => (a.stageOrder || 0) - (b.stageOrder || 0))[0];
            if (nextPesaje?.items) conservanteItems = nextPesaje.items.filter(i => i.plannedQuantity > 0);
        }
    }
    const allConservantesConfirmed = conservanteItems.length === 0 || conservanteItems.every((_, idx) => {
        const val = conservanteActuals[`conservante_${idx}`];
        return val && !isNaN(parseFloat(val)) && parseFloat(val) > 0;
    });

    // Timer state — recover from server (processParameters) on mount
    const [timerStarted, setTimerStarted] = useState(false);
    const [timerFinished, setTimerFinished] = useState(timerMin === 0);
    const [secondsLeft, setSecondsLeft] = useState(timerMin * 60);
    const intervalRef = useRef(null);

    // Alarm state
    const [alarmActive, setAlarmActive] = useState(false);
    const [alarmAcknowledged, setAlarmAcknowledged] = useState(timerMin === 0);
    const audioContextRef = useRef(null);
    const beepIntervalRef = useRef(null);
    const vibrationIntervalRef = useRef(null);

    // Recover state from server processParameters on mount
    useEffect(() => {
        // Recover from coccion_result (saved when step completes or photo uploaded)
        const saved = params.coccion_result;
        if (saved) {
            if (saved.photoUrl) setPhotoUrl(saved.photoUrl);
            if (saved.realTemperature) setRealTemperature(String(saved.realTemperature));
        }
        // Recover timer state
        if (timerMin === 0) return;
        const timerState = params.timerState;
        if (!timerState) return;
        if (timerState.acknowledged) {
            setTimerStarted(true);
            setTimerFinished(true);
            setAlarmAcknowledged(true);
            setSecondsLeft(0);
            if (timerState.realTemperature) setRealTemperature(String(timerState.realTemperature));
            if (timerState.photoUrl) setPhotoUrl(timerState.photoUrl);
            return;
        }
        if (timerState.startedAt) {
            const elapsed = Math.floor((Date.now() - timerState.startedAt) / 1000);
            const remaining = Math.max(0, (timerMin * 60) - elapsed);
            setTimerStarted(true);
            setSecondsLeft(remaining);
            if (timerState.realTemperature) setRealTemperature(String(timerState.realTemperature));
            if (timerState.photoUrl) setPhotoUrl(timerState.photoUrl);
            if (remaining === 0) {
                setTimerFinished(true);
                setAlarmActive(true);
            }
        }
    }, []);

    // Notify parent of state changes
    useEffect(() => {
        onCoccionChange?.({
            realTemperature: parseFloat(realTemperature) || null,
            targetTemperature: targetTemp,
            photoUrl,
            timerCompleted: timerFinished && alarmAcknowledged,
            isComplete: !!photoUrl && ((timerFinished && alarmAcknowledged) || timerMin === 0) && !!realTemperature && allConservantesConfirmed,
            conservanteActuals,
        });
    }, [realTemperature, photoUrl, timerFinished, alarmAcknowledged, allConservantesConfirmed, conservanteActuals]);

    // Timer countdown
    useEffect(() => {
        if (timerStarted && secondsLeft > 0) {
            intervalRef.current = setInterval(() => {
                setSecondsLeft(prev => {
                    if (prev <= 1) {
                        clearInterval(intervalRef.current);
                        setTimerFinished(true);
                        setAlarmActive(true);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(intervalRef.current);
    }, [timerStarted]);

    // Alarm: sound + vibration when timer finishes
    useEffect(() => {
        if (!alarmActive) return;

        // Start alarm sound using Web Audio API
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            audioContextRef.current = ctx;

            const playBeep = () => {
                if (!audioContextRef.current || audioContextRef.current.state === 'closed') return;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = 880;
                osc.type = 'square';
                gain.gain.value = 0.3;
                osc.start();
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
                osc.stop(ctx.currentTime + 0.5);
            };

            playBeep();
            beepIntervalRef.current = setInterval(playBeep, 1000);
        } catch (e) {
            console.warn('Audio not available:', e);
        }

        // Start continuous vibration
        const startVibration = () => {
            if ('vibrate' in navigator) {
                navigator.vibrate([500, 200, 500, 200, 500]);
            }
        };
        startVibration();
        vibrationIntervalRef.current = setInterval(startVibration, 2000);

        return () => stopAlarm();
    }, [alarmActive]);

    const stopAlarm = () => {
        if (beepIntervalRef.current) {
            clearInterval(beepIntervalRef.current);
            beepIntervalRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close().catch(() => { });
            audioContextRef.current = null;
        }
        if (vibrationIntervalRef.current) {
            clearInterval(vibrationIntervalRef.current);
            vibrationIntervalRef.current = null;
        }
        if ('vibrate' in navigator) navigator.vibrate(0);
    };

    const handleAcknowledge = () => {
        stopAlarm();
        setAlarmActive(false);
        setAlarmAcknowledged(true);
        // Save acknowledged state to server
        api.patch(`/assembly-notes/${note?.id}`, {
            processParameters: {
                ...params,
                timerState: { ...(params.timerState || {}), acknowledged: true }
            }
        }).catch(() => { });
    };

    const formatTime = (secs) => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    // Photo upload
    const fileInputRef = useRef(null);
    const handlePhotoCapture = useCallback(async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('photo', file);
            formData.append('noteId', note?.id || '');
            formData.append('context', `coccion_${targetTemp}`);
            const res = await api.post('/assembly-notes/upload-photo', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            const savedUrl = res.data.url || URL.createObjectURL(file);
            setPhotoUrl(savedUrl);
            // Immediately persist photo URL to processParameters so it survives refresh
            if (res.data.url && note?.id) {
                api.patch(`/assembly-notes/${note.id}`, {
                    processParameters: {
                        ...params,
                        coccion_result: {
                            ...(params.coccion_result || {}),
                            photoUrl: res.data.url,
                            capturedAt: new Date().toISOString()
                        }
                    }
                }).catch(() => {});
            }
        } catch (err) {
            setPhotoUrl(URL.createObjectURL(file));
        } finally {
            setUploading(false);
        }
    }, [note?.id, targetTemp, params]);

    const tempDiff = realTemperature ? Math.abs(parseFloat(realTemperature) - targetTemp) : null;
    const tempOk = tempDiff !== null && tempDiff <= 3;

    const isHeating = targetTemp > 50;
    const colors = isHeating
        ? { from: 'from-red-500', to: 'to-orange-400', border: 'border-red-400', bg: 'bg-red-50', text: 'text-red-700', accent: 'text-red-500' }
        : { from: 'from-cyan-500', to: 'to-blue-400', border: 'border-cyan-400', bg: 'bg-cyan-50', text: 'text-cyan-700', accent: 'text-cyan-500' };

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-8 pb-36 px-4">
            {/* ═══ ALARM MODAL ═══ */}
            {alarmActive && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full mx-4 p-8 text-center border-4 border-red-500 animate-pulse">
                        <div className="text-6xl mb-4 animate-bounce">🔔</div>
                        <h2 className="text-3xl font-black text-red-600 mb-2">¡TIEMPO COMPLETADO!</h2>
                        <p className="text-lg text-slate-700 font-medium mb-2">
                            El tiempo de cocción a <span className="font-black text-red-600">{targetTemp}{unit}</span> ha finalizado.
                        </p>
                        <p className="text-sm text-slate-500 mb-6">
                            Verifica que la cocción está lista antes de continuar al siguiente paso.
                        </p>
                        <button
                            onClick={handleAcknowledge}
                            className="w-full py-5 bg-red-600 hover:bg-red-700 text-white font-black text-xl rounded-2xl shadow-lg transition-all active:scale-95"
                        >
                            ✅ ENTENDIDO — COCCIÓN VERIFICADA
                        </button>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className={`h-12 w-12 rounded-full text-white flex items-center justify-center text-2xl shadow-md bg-gradient-to-br ${colors.from} ${colors.to}`}>
                    🌡️
                </div>
                <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                    CONTROL DE TEMPERATURA
                </div>
            </div>

            {/* Card */}
            <div className={`bg-white rounded-3xl shadow-2xl ${colors.border} border-4 overflow-hidden flex-1 flex flex-col`}>
                <div className={`bg-gradient-to-r ${colors.from} ${colors.to} p-4 text-center`}>
                    <span className="text-white font-extrabold text-lg uppercase tracking-widest">
                        🌡️ {note?.stageName || `Temperatura ${targetTemp}${unit}`}
                    </span>
                    <div className="text-white/70 text-xs mt-0.5">{isHeating ? 'Calentar' : 'Enfriar'} hasta alcanzar la temperatura objetivo</div>
                </div>

                <div className="flex-1 flex flex-col p-6 gap-5 overflow-auto">
                    {instruction && (
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 font-medium">
                            📋 {instruction}
                        </div>
                    )}

                    {/* Show conservante quantities if this step involves adding conservante */}
                    {(() => {
                        if (!isConservanteStep || conservanteItems.length === 0) return null;

                        return (
                            <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-4">
                                <div className="text-xs font-bold text-green-700 uppercase mb-3">
                                    🧪 Conservantes a agregar — confirme la cantidad pesada
                                </div>
                                {conservanteItems.map((item, idx) => {
                                    const planned = item.plannedQuantity;
                                    const label = planned >= 1000
                                        ? `${(planned / 1000).toFixed(2)} kg`
                                        : `${Math.round(planned)} g`;
                                    const actualKey = `conservante_${idx}`;
                                    const actualVal = conservanteActuals[actualKey] || '';
                                    const numVal = parseFloat(actualVal);
                                    const isConfirmed = actualVal && !isNaN(numVal);
                                    const diff = isConfirmed ? Math.abs(numVal - planned) / planned : null;
                                    const isOk = diff !== null && diff <= 0.05;
                                    return (
                                        <div key={idx} style={{
                                            background: '#fff', borderRadius: 12,
                                            border: isOk ? '2px solid #22c55e' : '1px solid #bbf7d0',
                                            padding: '10px 14px', marginBottom: idx < conservanteItems.length - 1 ? 8 : 0,
                                        }}>
                                            <div style={{ fontWeight: 700, color: '#166534', fontSize: '0.85rem', marginBottom: 6 }}>
                                                {item.component?.name || 'Ingrediente'}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <div style={{
                                                    flex: 1, textAlign: 'center',
                                                    background: '#dcfce7', borderRadius: 8, padding: '6px 8px',
                                                }}>
                                                    <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#15803d', textTransform: 'uppercase' }}>Meta</div>
                                                    <div style={{ fontWeight: 900, fontSize: '1.2rem', color: '#166534' }}>{label}</div>
                                                </div>
                                                <div style={{ flex: 1, textAlign: 'center' }}>
                                                    <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Real (g)</div>
                                                    <input
                                                        type="number"
                                                        step="0.1"
                                                        value={actualVal}
                                                        onChange={e => setConservanteActuals(prev => ({ ...prev, [actualKey]: e.target.value }))}
                                                        placeholder={String(Math.round(planned))}
                                                        style={{
                                                            width: '100%', textAlign: 'center', fontWeight: 900,
                                                            fontSize: '1.2rem', border: '2px solid #e2e8f0', borderRadius: 8,
                                                            padding: '4px 6px', outline: 'none',
                                                            color: isOk ? '#166534' : isConfirmed ? '#dc2626' : '#1e293b',
                                                            borderColor: isOk ? '#22c55e' : isConfirmed ? '#fca5a5' : '#e2e8f0',
                                                        }}
                                                    />
                                                </div>
                                                <div style={{ width: 28, textAlign: 'center', fontSize: '1.2rem' }}>
                                                    {isOk ? '✅' : isConfirmed ? '⚠️' : ''}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })()}

                    <div className="grid grid-cols-2 gap-4">
                        <div className={`${colors.bg} rounded-2xl p-4 text-center border ${colors.border}`}>
                            <div className={`text-xs font-bold ${colors.accent} uppercase mb-1`}>Temperatura Objetivo</div>
                            <div className={`text-4xl font-black ${colors.text}`}>{targetTemp}{unit}</div>
                        </div>
                        <div className="bg-slate-50 rounded-2xl p-4 text-center border border-slate-200">
                            <div className="text-xs font-bold text-slate-500 uppercase mb-1">Temperatura Real</div>
                            <input
                                type="number"
                                step="0.1"
                                value={realTemperature}
                                onChange={e => setRealTemperature(e.target.value)}
                                placeholder={`${targetTemp}`}
                                className={`text-4xl font-black w-full text-center bg-transparent border-none outline-none ${tempOk ? 'text-green-600' : realTemperature ? 'text-red-500' : 'text-slate-400'}`}
                            />
                            <div className="text-xs text-slate-400">{unit}</div>
                        </div>
                    </div>

                    {realTemperature && (
                        <div className={`flex items-center gap-2 text-sm font-bold rounded-xl p-3 ${tempOk ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                            {tempOk ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                            {tempOk ? '✅ Temperatura dentro del rango aceptable' : `⚠️ Diferencia de ${tempDiff?.toFixed(1)}${unit} vs objetivo`}
                        </div>
                    )}

                    <div className={`rounded-2xl p-4 border-2 border-dashed ${photoUrl ? 'border-green-400 bg-green-50' : 'border-slate-300 bg-slate-50'}`}>
                        <div className="text-xs font-bold text-slate-500 uppercase mb-2">
                            📸 Foto del Termómetro {photoRequired ? '(OBLIGATORIA)' : ''}
                        </div>
                        {photoUrl ? (
                            <div className="flex items-center gap-4">
                                <img src={photoUrl} alt="Termómetro" className="w-24 h-24 rounded-xl object-cover border-2 border-green-400" />
                                <div className="flex-1">
                                    <div className="text-green-700 font-bold text-sm">✅ Foto capturada</div>
                                    <button onClick={() => fileInputRef.current?.click()} className="text-xs text-blue-500 underline mt-1">Cambiar foto</button>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                className="w-full flex items-center justify-center gap-2 py-4 bg-white border-2 border-slate-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-all font-bold text-slate-600"
                            >
                                <Camera size={24} />
                                {uploading ? 'Subiendo...' : 'Tomar foto del termómetro'}
                            </button>
                        )}
                        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoCapture} />
                    </div>

                    {timerMin > 0 && (
                        <div className={`rounded-2xl p-6 text-center border-2 ${alarmAcknowledged ? 'border-green-400 bg-green-50' : timerStarted ? 'border-orange-400 bg-orange-50' : 'border-slate-300 bg-slate-50'}`}>
                            <div className="text-xs font-bold text-slate-500 uppercase mb-1">
                                <Timer className="w-4 h-4 inline mr-1" /> Cronómetro — {timerMin} minutos
                            </div>
                            <div className="text-xs text-slate-500 mb-2 font-medium">
                                ⏱️ Tiempo necesario para mantener la temperatura a {targetTemp}{unit} y garantizar la eliminación de bacterias
                            </div>
                            <div className={`text-6xl font-black font-mono tabular-nums ${alarmAcknowledged ? 'text-green-600' : timerStarted ? 'text-orange-600 animate-pulse' : 'text-slate-400'}`}>
                                {formatTime(secondsLeft)}
                            </div>
                            {!timerStarted && !timerFinished && (
                                <button
                                    onClick={() => {
                                        setTimerStarted(true);
                                        // Save start timestamp to server database
                                        api.patch(`/assembly-notes/${note?.id}`, {
                                            processParameters: {
                                                ...params,
                                                timerState: {
                                                    startedAt: Date.now(),
                                                    realTemperature: parseFloat(realTemperature) || null,
                                                    photoUrl
                                                }
                                            }
                                        }).catch(() => { });
                                    }}
                                    disabled={!photoUrl || !realTemperature}
                                    className="mt-4 px-8 py-3 bg-orange-500 hover:bg-orange-600 text-white font-black rounded-xl text-lg shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    ▶️ INICIAR CRONÓMETRO
                                </button>
                            )}
                            {timerStarted && !timerFinished && (
                                <div className="mt-2 text-sm text-orange-600 font-bold animate-pulse">⏳ En espera...</div>
                            )}
                            {timerStarted && !timerFinished && new URLSearchParams(window.location.search).has('debug') && (
                                <button
                                    onClick={() => {
                                        clearInterval(intervalRef.current);
                                        setSecondsLeft(0);
                                        setTimerFinished(true);
                                        setAlarmActive(true);
                                    }}
                                    className="mt-3 px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-500 font-medium rounded-lg text-xs transition-all"
                                >
                                    ⏭️ Saltar cronómetro (Admin)
                                </button>
                            )}
                            {alarmAcknowledged && (
                                <div className="mt-2 text-sm text-green-700 font-bold">✅ Tiempo completado y verificado — presiona SIGUIENTE</div>
                            )}
                            {!photoUrl && !timerStarted && (
                                <div className="mt-2 text-xs text-slate-400">Primero toma la foto y registra la temperatura para iniciar el cronómetro</div>
                            )}
                        </div>
                    )}

                    {timerMin === 0 && photoUrl && realTemperature && (
                        <div className="text-center text-green-600 font-bold text-sm animate-pulse">
                            ✅ Temperatura registrada y foto tomada — presiona SIGUIENTE
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CoccionStep;
