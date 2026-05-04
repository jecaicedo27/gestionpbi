import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square, Clock, AlertTriangle } from 'lucide-react';
import api from '../../../services/api';

/**
 * EsferificacionStep — Spherification process timer for Popping Boba.
 *
 * Features:
 * - Start button with date/time stamp
 * - Running chronometer
 * - Pause with reason modal (tracks pause time separately)
 * - Resume to continue accumulating
 * - Finish to complete the spherification
 * - Full event log
 */

const formatTime = (ms) => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const formatDateTime = (date) => {
    return new Date(date).toLocaleString('es-CO', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
};

const STATUS = { IDLE: 'IDLE', RUNNING: 'RUNNING', PAUSED: 'PAUSED', FINISHED: 'FINISHED' };

const DEFAULT_PAUSE_REASONS = [
    'Marmita bajo de temperatura',
    'Bomba de recirculacion de enfriamiento de agua',
    'Bomba de recirculacion del lavado de perlas',
    'Cabezal de inyeccion obstruido',
    'Bomba de recirculacion de alginato',
    'Bomba de ingreso de jarabe',
];

const EsferificacionStep = ({ stepData, onEsferificacionChange }) => {
    const noteData = stepData;
    const noteId = noteData?.id;
    const savedTimer = noteData?.processParameters?.esferificacion_timer;

    const [status, setStatus] = useState(STATUS.IDLE);
    const [startTime, setStartTime] = useState(null);
    const [elapsedMs, setElapsedMs] = useState(0);       // total running time (excludes pauses)
    const [pauseElapsedMs, setPauseElapsedMs] = useState(0); // total pause time
    const [segmentStart, setSegmentStart] = useState(null);  // start of current running segment
    const [pauseSegmentStart, setPauseSegmentStart] = useState(null);
    const [endTime, setEndTime] = useState(null);

    // Pause modal
    const [showPauseModal, setShowPauseModal] = useState(false);
    const [selectedPauseReason, setSelectedPauseReason] = useState('');
    const [customPauseReason, setCustomPauseReason] = useState('');
    const [pauseReasons, setPauseReasons] = useState(DEFAULT_PAUSE_REASONS);

    // Load custom pause reasons from config
    useEffect(() => {
        api.get('/config').then(r => {
            if (r.data?.esferificacion_pause_reasons?.length > 0) {
                const filtered = r.data.esferificacion_pause_reasons.filter(r => r && r.trim());
                if (filtered.length > 0) setPauseReasons(filtered);
            }
        }).catch(() => { });
    }, []);

    // Event log
    const [events, setEvents] = useState([]);

    // Concurrency gate — set when another FORMACION note has its esferificación
    // RUNNING/PAUSED. While set, the timer must NOT auto-start; the operator is
    // forced to FINALIZAR the other bache first.
    const [blockedBy, setBlockedBy] = useState(null);

    const intervalRef = useRef(null);
    const pauseIntervalRef = useRef(null);

    // ── Restore timer state from backend on mount ──────────────────────────
    // If no saved timer exists but the note already has `startedAt` (chained
    // from PROTECCION_GATE.completedAt), auto-initialize the chronometer from
    // that timestamp — eliminates manual "INICIAR" step and prevents operator
    // from manipulating the start moment.
    const restoredRef = useRef(false);
    useEffect(() => {
        if (restoredRef.current) return;

        // Case A: timer state already persisted — restore it
        if (savedTimer) {
            restoredRef.current = true;

            setStartTime(savedTimer.startTime || null);
            setEndTime(savedTimer.endTime || null);
            setEvents(savedTimer.events || []);
            setPauseElapsedMs(savedTimer.pauseElapsedMs || 0);

            if (savedTimer.status === STATUS.FINISHED) {
                setElapsedMs(savedTimer.elapsedMs || 0);
                setStatus(STATUS.FINISHED);
            } else if (savedTimer.status === STATUS.RUNNING && savedTimer.segmentStartedAt) {
                // Recalculate elapsed: saved base + time since segment started
                const now = Date.now();
                const segStart = new Date(savedTimer.segmentStartedAt).getTime();
                const liveElapsed = Math.max(0, now - segStart);
                setElapsedMs((savedTimer.elapsedMs || 0) + liveElapsed);
                setSegmentStart(now); // reset segment to now (tick will add from here)
                setStatus(STATUS.RUNNING);
            } else if (savedTimer.status === STATUS.PAUSED) {
                setElapsedMs(savedTimer.elapsedMs || 0);
                // Recalculate pause time: saved + time since pause started
                if (savedTimer.pauseStartedAt) {
                    const now = Date.now();
                    const pStart = new Date(savedTimer.pauseStartedAt).getTime();
                    const livePause = Math.max(0, now - pStart);
                    setPauseElapsedMs((savedTimer.pauseElapsedMs || 0) + livePause);
                    setPauseSegmentStart(now);
                }
                setStatus(STATUS.PAUSED);
            }
            return;
        }

        // Case B: no persisted timer but note.startedAt exists — auto-start
        // from the chained timestamp (PROTECCION_GATE.completedAt → note.startedAt)
        // BUT only if there is no other esferificación already RUNNING/PAUSED.
        // The planta supports a single esferificación at a time; if another is
        // open, the operator must FINALIZAR it manually before this one can begin.
        if (noteData?.startedAt) {
            restoredRef.current = true; // claim the slot synchronously to avoid double-fires
            (async () => {
                let activeOther = null;
                try {
                    const r = await api.get('/assembly-notes/active-esferificacion');
                    if (r.data?.active && r.data.noteId && r.data.noteId !== noteId) {
                        activeOther = r.data;
                    }
                } catch (e) {
                    console.warn('No se pudo verificar esferificación activa:', e.message);
                }

                if (activeOther) {
                    setBlockedBy(activeOther);
                    return; // queda IDLE hasta que el otro bache se cierre
                }

                const autoStartIso = noteData.startedAt;
                const autoStartMs = new Date(autoStartIso).getTime();
                const now = Date.now();
                const elapsed = Math.max(0, now - autoStartMs);
                const newEvent = {
                    type: 'INICIO',
                    detail: `Esferificación iniciada automáticamente al finalizar Protección — ${formatDateTime(autoStartIso)}`,
                    timestamp: autoStartIso,
                };
                setStartTime(autoStartIso);
                setSegmentStart(now);
                setElapsedMs(elapsed);
                setStatus(STATUS.RUNNING);
                setEvents([newEvent]);
                saveTimerState({
                    status: STATUS.RUNNING,
                    startTime: autoStartIso,
                    elapsedMs: elapsed,
                    pauseElapsedMs: 0,
                    segmentStartedAt: new Date(now).toISOString(),
                    events: [newEvent],
                });
            })();
        }
    }, [savedTimer, noteData?.startedAt, noteId]);

    // ── Persist timer state to backend ─────────────────────────────────────
    // El backend valida exclusividad de esferificación: si ya hay otra activa
    // y este intento de RUNNING/PAUSED choca, devuelve 409 con info del bloqueador.
    // En ese caso, revertimos el status local y mostramos el banner.
    const saveTimerState = async (overrides = {}) => {
        if (!noteId) return;
        try {
            const res = await api.get(`/assembly-notes/${noteId}`);
            const currentParams = res.data?.processParameters || {};
            const existing = currentParams.esferificacion_timer || {};
            const payload = {
                status: overrides.status ?? status,
                startTime: overrides.startTime ?? startTime,
                endTime: overrides.endTime ?? endTime,
                elapsedMs: overrides.elapsedMs ?? elapsedMs,
                pauseElapsedMs: overrides.pauseElapsedMs ?? pauseElapsedMs,
                segmentStartedAt: 'segmentStartedAt' in overrides ? overrides.segmentStartedAt : existing.segmentStartedAt || null,
                pauseStartedAt: 'pauseStartedAt' in overrides ? overrides.pauseStartedAt : existing.pauseStartedAt || null,
                events: overrides.events ?? events,
            };
            await api.patch(`/assembly-notes/${noteId}`, {
                processParameters: { ...currentParams, esferificacion_timer: payload }
            });
        } catch (e) {
            // 409 = bloqueado por otra esferificación activa
            if (e.response?.status === 409 && e.response?.data?.blockingNoteId) {
                const d = e.response.data;
                setBlockedBy({
                    noteId: d.blockingNoteId,
                    batchNumber: d.blockingBatchNumber,
                    flavor: d.blockingFlavor,
                    operatorName: d.blockingOperator,
                });
                // Revertir status local: no quedó RUNNING ni PAUSED en BD
                setStatus(STATUS.IDLE);
                setStartTime(null);
                setSegmentStart(null);
                setElapsedMs(0);
                setEvents([]);
                return;
            }
            console.warn('Could not save timer state:', e.message);
        }
    };

    // While the auto-start is blocked by another active esferificación, poll
    // the backend every 10s. As soon as the other bache is FINALIZADO, kick
    // off the normal Case B auto-start path by clearing blockedBy and resetting
    // the restored flag so the main effect can re-run.
    useEffect(() => {
        if (!blockedBy) return;
        const tick = setInterval(async () => {
            try {
                const r = await api.get('/assembly-notes/active-esferificacion');
                if (!r.data?.active || r.data.noteId === noteId) {
                    setBlockedBy(null);
                    restoredRef.current = false; // permitir re-evaluación
                }
            } catch { /* swallow */ }
        }, 10_000);
        return () => clearInterval(tick);
    }, [blockedBy, noteId]);

    // Tick timer for running state
    useEffect(() => {
        if (status === STATUS.RUNNING && segmentStart) {
            intervalRef.current = setInterval(() => {
                setElapsedMs(prev => prev + 1000);
            }, 1000);
        }
        return () => clearInterval(intervalRef.current);
    }, [status, segmentStart]);

    // Tick timer for pause state
    useEffect(() => {
        if (status === STATUS.PAUSED && pauseSegmentStart) {
            pauseIntervalRef.current = setInterval(() => {
                setPauseElapsedMs(prev => prev + 1000);
            }, 1000);
        }
        return () => clearInterval(pauseIntervalRef.current);
    }, [status, pauseSegmentStart]);

    // Notify parent
    useEffect(() => {
        onEsferificacionChange?.({
            isComplete: status === STATUS.FINISHED,
            status,
            startTime,
            endTime,
            elapsedMs,
            pauseElapsedMs,
            events,
        });
    }, [status, startTime, endTime, elapsedMs, pauseElapsedMs, events]);

    const addEvent = (type, detail = '') => {
        setEvents(prev => [...prev, { type, detail, timestamp: new Date().toISOString() }]);
    };

    // ── Actions ──
    const handlePause = () => {
        clearInterval(intervalRef.current);
        setSegmentStart(null);
        const nowIso = new Date().toISOString();
        setPauseSegmentStart(Date.now());
        setStatus(STATUS.PAUSED);
        setShowPauseModal(true);
        saveTimerState({
            status: STATUS.PAUSED,
            elapsedMs,
            pauseStartedAt: nowIso,
        });
    };

    const handleConfirmPause = () => {
        const reason = selectedPauseReason === 'Otro'
            ? 'Otro: ' + (customPauseReason.trim() || 'Sin detalle')
            : selectedPauseReason || 'Sin detalle';
        const newEvent = { type: 'PAUSA', detail: reason, timestamp: new Date().toISOString() };
        setEvents(prev => {
            const updated = [...prev, newEvent];
            saveTimerState({ events: updated });
            return updated;
        });
        setSelectedPauseReason('');
        setCustomPauseReason('');
        setShowPauseModal(false);
    };

    const handleResume = () => {
        clearInterval(pauseIntervalRef.current);
        setPauseSegmentStart(null);
        const nowIso = new Date().toISOString();
        setSegmentStart(Date.now());
        setStatus(STATUS.RUNNING);
        const newEvent = { type: 'REANUDACIÓN', detail: 'Proceso reanudado', timestamp: nowIso };
        setEvents(prev => {
            const updated = [...prev, newEvent];
            saveTimerState({
                status: STATUS.RUNNING,
                pauseElapsedMs,
                segmentStartedAt: nowIso,
                events: updated,
            });
            return updated;
        });
    };

    const handleFinish = () => {
        clearInterval(intervalRef.current);
        clearInterval(pauseIntervalRef.current);
        const now = new Date();
        const nowIso = now.toISOString();
        setEndTime(nowIso);
        setSegmentStart(null);
        setPauseSegmentStart(null);
        setStatus(STATUS.FINISHED);
        const newEvent = { type: 'FINALIZACIÓN', detail: `Esferificación terminada a las ${formatDateTime(now)}`, timestamp: nowIso };
        setEvents(prev => {
            const updated = [...prev, newEvent];
            saveTimerState({
                status: STATUS.FINISHED,
                endTime: nowIso,
                elapsedMs,
                pauseElapsedMs,
                events: updated,
            });
            return updated;
        });
    };

    // Status colors
    const statusColor = {
        [STATUS.IDLE]: 'from-slate-500 to-slate-600',
        [STATUS.RUNNING]: 'from-emerald-500 to-teal-600',
        [STATUS.PAUSED]: 'from-amber-500 to-orange-600',
        [STATUS.FINISHED]: 'from-blue-500 to-indigo-600',
    };

    const statusLabel = {
        [STATUS.IDLE]: '⏸️ SIN INICIAR',
        [STATUS.RUNNING]: '🟢 EN PROCESO',
        [STATUS.PAUSED]: '⏸️ EN PAUSA',
        [STATUS.FINISHED]: '✅ FINALIZADO',
    };

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto pt-8 pb-36 px-4">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-emerald-600 to-teal-500 text-white flex items-center justify-center text-2xl shadow-md">
                    🫧
                </div>
                <div>
                    <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">PROCESO DE ESFERIFICACIÓN</div>
                    <div className="text-xs text-slate-400">Popping Boba — Cronómetro de producción</div>
                </div>
            </div>

            <div className="bg-white rounded-3xl shadow-2xl border-4 border-teal-400 overflow-hidden flex-1 flex flex-col">
                {/* Status bar */}
                <div className={`bg-gradient-to-r ${statusColor[status]} p-4 text-center`}>
                    <span className="text-white font-extrabold text-lg uppercase tracking-widest">
                        {statusLabel[status]}
                    </span>
                </div>

                <div className="flex-1 flex flex-col p-6 gap-5 overflow-auto">

                    {/* ═══ BLOCKED BANNER (otra esferificación en curso) ═══ */}
                    {blockedBy && status === STATUS.IDLE && (
                        <div className="rounded-2xl border-4 border-red-400 bg-red-50 p-5">
                            <div className="flex items-start gap-3">
                                <AlertTriangle size={28} className="text-red-600 flex-shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <div className="font-extrabold text-red-700 text-base mb-1">
                                        ⛔ No puedes iniciar esta esferificación
                                    </div>
                                    <div className="text-sm text-red-700 mb-3">
                                        Hay otra esferificación en curso:&nbsp;
                                        <b>{blockedBy.batchNumber || blockedBy.flavor || 'bache desconocido'}</b>
                                        {blockedBy.operatorName && <> · Op. <b>{blockedBy.operatorName}</b></>}
                                        {typeof blockedBy.elapsedMinutes === 'number' && <> · {blockedBy.elapsedMinutes} min</>}
                                        {blockedBy.timerStatus === 'PAUSED' && <> · ⏸️ EN PAUSA</>}
                                        .<br />
                                        Debes pulsar <b>FINALIZAR</b> en ese bache antes de iniciar este.
                                    </div>
                                    {blockedBy.noteId && (
                                        <button
                                            onClick={() => { window.location.href = `/assembly-execution/${blockedBy.noteId}`; }}
                                            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm uppercase tracking-wider shadow active:scale-95">
                                            Ir al bache en curso →
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ═══ DATE/TIME INFO ═══ */}
                    {startTime && (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-slate-50 rounded-2xl p-3 text-center border border-slate-200">
                                <div className="text-xs text-slate-400 font-bold uppercase mb-1">Inicio</div>
                                <div className="text-sm font-black text-slate-700">{formatDateTime(startTime)}</div>
                            </div>
                            {endTime ? (
                                <div className="bg-blue-50 rounded-2xl p-3 text-center border border-blue-200">
                                    <div className="text-xs text-blue-400 font-bold uppercase mb-1">Fin</div>
                                    <div className="text-sm font-black text-blue-700">{formatDateTime(endTime)}</div>
                                </div>
                            ) : (
                                <div className="bg-emerald-50 rounded-2xl p-3 text-center border border-emerald-200">
                                    <div className="text-xs text-emerald-400 font-bold uppercase mb-1">Estado</div>
                                    <div className="text-sm font-black text-emerald-700">
                                        {status === STATUS.PAUSED ? '⏸️ En pausa' : '🟢 En curso'}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══ CHRONOMETER ═══ */}
                    <div className={`rounded-3xl p-6 text-center border-4 transition-all ${status === STATUS.RUNNING ? 'bg-emerald-50 border-emerald-400' :
                        status === STATUS.PAUSED ? 'bg-amber-50 border-amber-400 animate-pulse' :
                            status === STATUS.FINISHED ? 'bg-blue-50 border-blue-400' :
                                'bg-slate-50 border-slate-300'
                        }`}>
                        <div className="flex items-center justify-center gap-3 mb-2">
                            <Clock size={24} className={
                                status === STATUS.RUNNING ? 'text-emerald-600' :
                                    status === STATUS.PAUSED ? 'text-amber-600' :
                                        'text-slate-400'
                            } />
                            <span className="text-xs font-bold text-slate-400 uppercase">Tiempo de Esferificación</span>
                        </div>
                        <div className={`text-6xl font-black tracking-wider font-mono ${status === STATUS.RUNNING ? 'text-emerald-700' :
                            status === STATUS.PAUSED ? 'text-amber-700' :
                                status === STATUS.FINISHED ? 'text-blue-700' :
                                    'text-slate-400'
                            }`}>
                            {formatTime(elapsedMs)}
                        </div>

                        {/* Pause time indicator */}
                        {pauseElapsedMs > 0 && (
                            <div className="mt-3 flex items-center justify-center gap-2">
                                <Pause size={14} className="text-amber-500" />
                                <span className="text-sm font-bold text-amber-600">
                                    Tiempo en pausa: {formatTime(pauseElapsedMs)}
                                </span>
                            </div>
                        )}

                        {/* Total time = running + pause */}
                        {startTime && (
                            <div className="mt-2 text-xs text-slate-400">
                                Tiempo total (incluye pausas): {formatTime(elapsedMs + pauseElapsedMs)}
                            </div>
                        )}
                    </div>

                    {/* ═══ CONTROL BUTTONS ═══ */}
                    {/* Auto-start from note.startedAt — no manual INICIAR button.
                        IDLE only appears when the note has no startedAt (edge case). */}
                    <div className="flex gap-3">
                        {status === STATUS.IDLE && !blockedBy && (
                            <div className="flex-1 flex items-center justify-center gap-3 py-5 rounded-2xl bg-slate-100 border-2 border-slate-300 text-slate-500 font-bold text-sm text-center px-4">
                                ⏳ Esperando finalización del paso PROTECCIÓN para auto-iniciar el cronómetro…
                            </div>
                        )}

                        {status === STATUS.RUNNING && (
                            <>
                                <button
                                    onClick={handlePause}
                                    className="flex-1 flex items-center justify-center gap-3 py-5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-extrabold text-lg uppercase tracking-wider shadow-lg hover:shadow-xl transition-all active:scale-95">
                                    <Pause size={28} />
                                    PAUSAR
                                </button>
                                <button
                                    onClick={handleFinish}
                                    className="flex-1 flex items-center justify-center gap-3 py-5 rounded-2xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-extrabold text-lg uppercase tracking-wider shadow-lg hover:shadow-xl transition-all active:scale-95">
                                    <Square size={28} fill="white" />
                                    FINALIZAR
                                </button>
                            </>
                        )}

                        {status === STATUS.PAUSED && (
                            <>
                                <button
                                    onClick={handleResume}
                                    className="flex-1 flex items-center justify-center gap-3 py-5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-extrabold text-lg uppercase tracking-wider shadow-lg hover:shadow-xl transition-all active:scale-95">
                                    <Play size={28} fill="white" />
                                    REANUDAR
                                </button>
                                <button
                                    onClick={handleFinish}
                                    className="flex-1 flex items-center justify-center gap-3 py-5 rounded-2xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-extrabold text-lg uppercase tracking-wider shadow-lg hover:shadow-xl transition-all active:scale-95">
                                    <Square size={28} fill="white" />
                                    FINALIZAR
                                </button>
                            </>
                        )}

                        {status === STATUS.FINISHED && (
                            <div className="flex-1 flex items-center justify-center gap-3 py-5 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-extrabold text-lg uppercase tracking-wider">
                                ✅ ESFERIFICACIÓN COMPLETADA
                            </div>
                        )}
                    </div>

                    {/* ═══ EVENT LOG ═══ */}
                    {events.length > 0 && (
                        <div className="rounded-2xl border-2 border-slate-200 overflow-hidden">
                            <div className="bg-slate-100 p-3 text-center">
                                <span className="font-bold text-slate-600 text-sm uppercase tracking-wider">
                                    📋 Registro de Eventos
                                </span>
                            </div>
                            <div className="p-3 space-y-2 max-h-48 overflow-auto bg-white">
                                {events.map((evt, i) => (
                                    <div key={i} className={`flex items-start gap-3 p-3 rounded-xl text-sm ${evt.type === 'INICIO' ? 'bg-emerald-50 border border-emerald-200' :
                                        evt.type === 'PAUSA' ? 'bg-amber-50 border border-amber-200' :
                                            evt.type === 'REANUDACIÓN' ? 'bg-blue-50 border border-blue-200' :
                                                'bg-slate-50 border border-slate-200'
                                        }`}>
                                        <span className="font-extrabold text-xs min-w-[100px] mt-0.5">
                                            {evt.type === 'INICIO' && '🟢 INICIO'}
                                            {evt.type === 'PAUSA' && '⏸️ PAUSA'}
                                            {evt.type === 'REANUDACIÓN' && '▶️ REANUDACIÓN'}
                                            {evt.type === 'FINALIZACIÓN' && '🏁 FIN'}
                                        </span>
                                        <div className="flex-1">
                                            <div className="text-slate-700 font-medium">{evt.detail}</div>
                                            <div className="text-xs text-slate-400 mt-0.5">{formatDateTime(evt.timestamp)}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Status summary */}
                    <div className={`text-center py-3 rounded-2xl font-bold text-sm ${status === STATUS.FINISHED
                        ? 'bg-green-100 text-green-700 border-2 border-green-300'
                        : 'bg-amber-100 text-amber-700 border-2 border-amber-300'
                        }`}>
                        {status === STATUS.FINISHED
                            ? `✅ Esferificación completada — Tiempo: ${formatTime(elapsedMs)} (Pausas: ${formatTime(pauseElapsedMs)})`
                            : status === STATUS.IDLE
                                ? (blockedBy
                                    ? `⛔ Bloqueado — finalice el bache ${blockedBy.batchNumber || 'en curso'} para continuar`
                                    : '⏳ El cronómetro arrancará automáticamente al pasar al paso de esferificación')
                                : '⚠️ Debe FINALIZAR la esferificación para continuar'
                        }
                    </div>
                </div>
            </div>

            {/* ═══ PAUSE REASON MODAL ═══ */}
            {showPauseModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden max-h-[90vh] flex flex-col">
                        <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-4 text-center flex-shrink-0">
                            <span className="text-white font-extrabold text-lg uppercase tracking-widest">
                                ⏸️ MOTIVO DE PAUSA
                            </span>
                        </div>
                        <div className="p-5 space-y-3 overflow-auto flex-1">
                            <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl border border-amber-200">
                                <AlertTriangle size={20} className="text-amber-600 flex-shrink-0" />
                                <span className="text-sm text-amber-800 font-medium">
                                    Seleccione el tipo de afectación
                                </span>
                            </div>

                            {/* Predefined reason buttons */}
                            <div className="space-y-2">
                                {pauseReasons.map((reason) => (
                                    <button
                                        key={reason}
                                        onClick={() => { setSelectedPauseReason(reason); setCustomPauseReason(''); }}
                                        className={`w-full text-left p-3 rounded-xl border-2 font-medium text-sm transition-all active:scale-[0.98] ${selectedPauseReason === reason
                                            ? 'bg-amber-100 border-amber-400 text-amber-800'
                                            : 'bg-white border-slate-200 text-slate-700 hover:border-amber-300'
                                            }`}>
                                        {selectedPauseReason === reason ? '🔘 ' : '⚪ '}{reason}
                                    </button>
                                ))}
                                {/* "Otro" option */}
                                <button
                                    onClick={() => setSelectedPauseReason('Otro')}
                                    className={`w-full text-left p-3 rounded-xl border-2 font-medium text-sm transition-all active:scale-[0.98] ${selectedPauseReason === 'Otro'
                                        ? 'bg-amber-100 border-amber-400 text-amber-800'
                                        : 'bg-white border-slate-200 text-slate-700 hover:border-amber-300'
                                        }`}>
                                    {selectedPauseReason === 'Otro' ? '🔘 ' : '⚪ '}Otro
                                </button>
                            </div>

                            {/* Custom reason text when "Otro" selected */}
                            {selectedPauseReason === 'Otro' && (
                                <textarea
                                    value={customPauseReason}
                                    onChange={(e) => setCustomPauseReason(e.target.value)}
                                    placeholder="Describa el motivo de la pausa..."
                                    rows={3}
                                    autoFocus
                                    className="w-full p-3 rounded-xl border-2 border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200 text-slate-700 text-sm resize-none"
                                />
                            )}

                            <button
                                onClick={handleConfirmPause}
                                disabled={!selectedPauseReason || (selectedPauseReason === 'Otro' && !customPauseReason.trim())}
                                className={`w-full py-4 rounded-xl font-extrabold text-base uppercase tracking-wider shadow-lg transition-all active:scale-95 ${!selectedPauseReason || (selectedPauseReason === 'Otro' && !customPauseReason.trim())
                                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:shadow-xl'
                                    }`}>
                                CONFIRMAR PAUSA
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EsferificacionStep;
